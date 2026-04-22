import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { webhookRouter, inicializarRouter } from './webhook/router.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from './integrations/whatsapp/index.js'
import { crearLLM } from './integrations/llm/index.js'
import { inicializarPipeline } from './pipeline/procesarMensajeEntrante.js'

const adapter = crearAdapterWhatsApp()
const sender = crearSenderWhatsApp()
const llm = crearLLM()

inicializarRouter(adapter)
inicializarPipeline(sender, llm)

const app = new Hono()

app.get('/health', (c) => c.json({
  status: 'ok',
  provider: process.env['WHATSAPP_PROVIDER'],
  llm: process.env['WASAGRO_LLM'],
}))
app.route('/webhook', webhookRouter)

export { llm }

serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })
