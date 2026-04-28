import { Hono } from 'hono'
import type { Context } from 'hono'
import { langfuse } from '../integrations/langfuse.js'
import { getBoss } from '../workers/pgBoss.js'
import type { IWhatsAppAdapter } from '../integrations/whatsapp/IWhatsAppAdapter.js'

// In-memory dedup: Evolution API sends the same webhook 6-8 times per message.
// singletonKey in pg-boss has a race condition when requests arrive simultaneously.
// This set prevents enqueuing the same wamid more than once per 60s window.
const recentWamids = new Set<string>()
const WAMID_TTL_MS = 60_000
function isDuplicate(wamid: string): boolean {
  if (recentWamids.has(wamid)) return true
  recentWamids.add(wamid)
  setTimeout(() => recentWamids.delete(wamid), WAMID_TTL_MS)
  return false
}

let adapter: IWhatsAppAdapter

export function inicializarRouter(adapterInstancia: IWhatsAppAdapter): void {
  adapter = adapterInstancia
}

export const webhookRouter = new Hono()

// GET /webhook/whatsapp — verificación del webhook (Meta solamente)
webhookRouter.get('/whatsapp', (c) => {
  const anyAdapter = adapter as unknown as { verificarGetWebhook?: (c: Context) => string | false }
  if (anyAdapter?.verificarGetWebhook) {
    const challenge = anyAdapter.verificarGetWebhook(c)
    if (challenge !== false) return c.text(challenge, 200)
  }
  return c.text('Forbidden', 403)
})

// POST /webhook/whatsapp — mensajes entrantes de cualquier provider
webhookRouter.post('/whatsapp', async (c) => {
  const trace = langfuse.trace({
    name: 'wa_message_received',
    metadata: { provider: process.env['WHATSAPP_PROVIDER'] },
  })

  // Verificar firma del provider — retorna 403 si inválida
  const esValido = await adapter.verificarWebhook(c)
  if (!esValido) {
    trace.event({ name: 'signature_invalid', level: 'WARNING' })
    return c.json({ error: 'Invalid signature' }, 403)
  }

  // Leer body antes de responder (el stream solo se puede leer una vez)
  const payload = await c.req.json() as unknown
  trace.event({ name: 'reception_ok', level: 'DEFAULT' })

  // Parsear mensaje y encolar trabajo en pg-boss antes de retornar 200
  const msg = adapter.parsearMensaje(payload)
  if (msg) {
    if (isDuplicate(msg.wamid)) {
      console.log(`[webhook] wamid duplicado ignorado: ${msg.wamid}`)
      return c.json({ status: 'received' }, 200)
    }
    console.log(`[webhook] mensaje de ${msg.from} tipo=${msg.tipo} wamid=${msg.wamid}`)
    try {
      const boss = getBoss()
      const jobId = await boss.send('procesar-mensaje', { msg, traceId: trace.id }, {
        singletonKey: msg.wamid,
        retryLimit: 3,
        retryBackoff: true,
      })
      console.log(`[webhook] job encolado: ${jobId ?? 'singleton-exists'} para ${msg.from}`)
      trace.event({ name: 'job_enqueued', output: { jobId, singletonKey: msg.wamid } })
    } catch (err: unknown) {
      console.error(`[webhook] ERROR al encolar job: ${String(err)}`)
      trace.event({ name: 'enqueue_error', level: 'ERROR', output: { error: String(err) } })
      return c.json({ error: 'Failed to enqueue message' }, 500)
    }
  } else {
    console.log(`[webhook] mensaje descartado (parsearMensaje=null) — ver log de EvolutionAdapter`)
    trace.event({ name: 'message_ignored', level: 'DEFAULT', input: { reason: 'parsearMensaje returned null' } })
  }

  // HTTP 200 inmediato — el pipeline corre en background (P3: <5s al agricultor)
  return c.json({ status: 'received' }, 200)
})
