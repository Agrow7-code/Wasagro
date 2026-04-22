import { Hono } from 'hono'
import type { Context } from 'hono'
import { langfuse } from '../integrations/langfuse.js'
import { procesarMensajeEntrante } from '../pipeline/procesarMensajeEntrante.js'
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

  // Parsear mensaje y despachar async (fire-and-forget) antes de retornar 200
  const msg = adapter.parsearMensaje(payload)
  if (msg) {
    void procesarMensajeEntrante(msg, trace.id).catch((err: unknown) => {
      trace.event({ name: 'pipeline_error', level: 'ERROR', output: { error: String(err) } })
    })
  } else {
    trace.event({ name: 'message_ignored', level: 'DEFAULT', input: { reason: 'parsearMensaje returned null' } })
  }

  // HTTP 200 inmediato — el pipeline corre en background (P3: <5s al agricultor)
  return c.json({ status: 'received' }, 200)
})
