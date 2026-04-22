import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { webhookRouter, inicializarRouter } from './webhook/router.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from './integrations/whatsapp/index.js'
import { crearLLM } from './integrations/llm/index.js'
import { inicializarPipeline } from './pipeline/procesarMensajeEntrante.js'

console.log('[startup] env check — WHATSAPP_PROVIDER:', process.env['WHATSAPP_PROVIDER'], 'WASAGRO_LLM:', process.env['WASAGRO_LLM'], 'SUPABASE_URL:', !!process.env['SUPABASE_URL'], 'SUPABASE_SERVICE_ROLE_KEY:', !!process.env['SUPABASE_SERVICE_ROLE_KEY'])

const adapter = crearAdapterWhatsApp()
console.log('[startup] adapter OK')
const sender = crearSenderWhatsApp()
console.log('[startup] sender OK')
const llm = crearLLM()
console.log('[startup] llm OK')

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

const port = Number(process.env['PORT'] ?? 3000)
console.log('[startup] binding to port', port)
serve({ fetch: app.fetch, port })
console.log('[startup] server running on port', port)
