import { Hono } from 'hono'
import type { Context } from 'hono'
import { langfuse } from '../integrations/langfuse.js'
import { getBoss } from '../workers/pgBoss.js'
import type { IWhatsAppAdapter } from '../integrations/whatsapp/IWhatsAppAdapter.js'

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
    try {
      const boss = getBoss()
      const jobId = await boss.send('procesar-mensaje', { msg, traceId: trace.id }, {
        singletonKey: msg.wamid,
        retryLimit: 3,
        retryBackoff: true,
      })
      trace.event({ name: 'job_enqueued', output: { jobId, singletonKey: msg.wamid } })
    } catch (err: unknown) {
      trace.event({ name: 'enqueue_error', level: 'ERROR', output: { error: String(err) } })
      return c.json({ error: 'Failed to enqueue message' }, 500)
    }
  } else {
    trace.event({ name: 'message_ignored', level: 'DEFAULT', input: { reason: 'parsearMensaje returned null' } })
  }

  // HTTP 200 inmediato — el pipeline corre en background (P3: <5s al agricultor)
  return c.json({ status: 'received' }, 200)
})
