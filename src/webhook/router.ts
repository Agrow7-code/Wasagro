import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { langfuse } from '../integrations/langfuse.js'

export const webhookRouter = new Hono()

// GET /webhook/whatsapp — verificación del webhook con Meta
webhookRouter.get('/whatsapp', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === process.env['WHATSAPP_VERIFY_TOKEN']) {
    return c.text(challenge ?? '', 200)
  }
  return c.text('Forbidden', 403)
})

// POST /webhook/whatsapp — mensajes entrantes
webhookRouter.post('/whatsapp', async (c) => {
  const rawBody = await c.req.text()

  // Validar firma HMAC-SHA256 de Meta
  const signature = c.req.header('x-hub-signature-256') ?? ''
  const secret = process.env['WHATSAPP_APP_SECRET'] ?? ''
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuffer = Buffer.from(signature)
  const expBuffer = Buffer.from(expected)
  if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
    return c.json({ error: 'Invalid signature' }, 403)
  }

  const payload = JSON.parse(rawBody) as unknown

  // Trace de recepción — P4: todo mensaje recibido queda registrado
  const trace = langfuse.trace({
    name: 'wa_message_received',
    input: { raw: payload },
    metadata: { source: 'whatsapp_webhook' },
  })

  try {
    // TODO: validar payload con Zod (WhatsAppMessageSchema) y despachar a pipeline
    trace.event({ name: 'reception_ok', level: 'DEFAULT' })
    return c.json({ status: 'received' }, 200)
  } catch (error) {
    trace.event({ name: 'reception_error', level: 'ERROR', output: { error: String(error) } })
    return c.json({ error: 'Internal error' }, 500)
  }
})
