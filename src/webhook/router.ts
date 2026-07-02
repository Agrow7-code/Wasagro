import { Hono } from 'hono'
import type { Context } from 'hono'
import { langfuse } from '../integrations/langfuse.js'
import { getBoss } from '../workers/pgBoss.js'
import type { IWhatsAppAdapter } from '../integrations/whatsapp/IWhatsAppAdapter.js'
import { setIfNotExists } from '../integrations/redis.js'
import { handleCalcomWebhook } from '../integrations/calcom/calcomWebhook.js'

// Cross-instance dedup for incoming webhooks. Evolution API delivers the same
// webhook 6-8 times per message; pg-boss singletonKey has a race window when
// the duplicates arrive within milliseconds of each other AND land on different
// process instances (Railway autoscales). An in-memory Set only deduped per
// instance, so two instances each processed the message once -> 'doble mensaje'
// observed in production with real clients.
//
// Now: Redis SET NX EX 60. Atomic, shared across the fleet, single source of
// truth. Falls back to an in-memory Set if Redis is unreachable so the webhook
// keeps working (degrades to the old buggy behavior rather than dropping
// messages entirely).
const WAMID_TTL_S = 60
const WAMID_TTL_MS = WAMID_TTL_S * 1000
const recentWamidsLocal = new Set<string>()

async function isDuplicate(wamid: string): Promise<boolean> {
  try {
    const wasSet = await setIfNotExists(`wamid:${wamid}`, WAMID_TTL_S)
    return !wasSet  // wasSet=true means we just inserted = first time; false means it already existed = duplicate
  } catch {
    // Redis hiccup: fall back to per-instance in-memory dedup. Imperfect across
    // instances but better than processing the same message N times.
    if (recentWamidsLocal.has(wamid)) return true
    recentWamidsLocal.add(wamid)
    setTimeout(() => recentWamidsLocal.delete(wamid), WAMID_TTL_MS)
    return false
  }
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
    if (await isDuplicate(msg.wamid)) {
      console.log(`[webhook] wamid duplicado ignorado: ${msg.wamid}`)
      return c.json({ status: 'received' }, 200)
    }

    // founder-crm PR5: a `fromMe` event (founder's own linked device, or an
    // echo of our own send) is routed OUT of the normal inbound pipeline —
    // it must NEVER reach procesarMensajeEntrante/handleEvento (field-path
    // safety, P1). It is ALSO routed OFF the synchronous webhook path: the
    // handler can do up to 4 sequential Supabase round-trips, which would
    // block the <1s ack (CR2). Enqueue and return 200 immediately, same
    // pattern as the procesar-mensaje enqueue below. singletonKey: msg.wamid
    // also collapses cross-instance duplicates if the Redis dedup above
    // degrades (see isDuplicate fallback).
    if (msg.esFromMe) {
      console.log(`[webhook] fromMe de ${msg.from} wamid=${msg.wamid} — encolando founder-manual-reply`)
      try {
        await getBoss().send('founder-manual-reply', { msg, traceId: trace.id }, {
          singletonKey: msg.wamid,
          retryLimit: 3,
          retryBackoff: true,
        })
        trace.event({ name: 'founder_manual_reply_enqueued', level: 'DEFAULT', input: { phone: msg.from, wamid: msg.wamid } })
      } catch (err: unknown) {
        console.error(`[webhook] ERROR al encolar founder-manual-reply: ${String(err)}`)
        trace.event({ name: 'founder_manual_reply_enqueue_error', level: 'ERROR', output: { error: String(err) } })
      }
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

// POST /webhook/calcom — Cal.com booking webhook (D23)
webhookRouter.post('/calcom', async (c) => {
  const secret = process.env['CALCOM_WEBHOOK_SECRET']
  if (!secret) {
    return c.json({ error: 'CALCOM_WEBHOOK_SECRET not configured' }, 500)
  }

  const rawBody = await c.req.text()
  const signature = c.req.header('x-cal-signature-256')

  const result = await handleCalcomWebhook(rawBody, signature, secret)

  if (result.status === 'rejected') return c.json({ error: result.detail }, 403)
  if (result.status === 'error') return c.json({ error: result.detail }, 400)
  return c.json(result, 200)
})
