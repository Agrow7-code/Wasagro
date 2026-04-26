import { handle } from 'hono/vercel'
import { Hono } from 'hono'
import { authRouter } from '../src/auth/router.js'
import { webhookRouter, inicializarRouter } from '../src/webhook/router.js'
import { inicializarPipeline } from '../src/pipeline/procesarMensajeEntrante.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from '../src/integrations/whatsapp/index.js'
import { crearLLM } from '../src/integrations/llm/index.js'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRouter)

// Webhook: inicializar solo si las vars necesarias están configuradas
try {
  inicializarRouter(crearAdapterWhatsApp())
  inicializarPipeline(crearSenderWhatsApp(), crearLLM())
  app.route('/webhook', webhookRouter)
} catch (err) {
  console.warn('[vercel] webhook no inicializado:', err instanceof Error ? err.message : err)
}

export const config = {
  runtime: 'nodejs'
}

export default handle(app)
