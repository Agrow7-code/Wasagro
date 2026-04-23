import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import cron from 'node-cron'
import { webhookRouter, inicializarRouter } from './webhook/router.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from './integrations/whatsapp/index.js'
import { crearLLM } from './integrations/llm/index.js'
import { inicializarPipeline } from './pipeline/procesarMensajeEntrante.js'
import { generarYEnviarReportes } from './pipeline/reporteSemanal.js'
import { langfuse } from './integrations/langfuse.js'

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

// POST /reportes/semanal — trigger manual de reportes (protegido por secret)
app.post('/reportes/semanal', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  if (!secret || secret !== process.env['REPORTE_SECRET']) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const trace = langfuse.trace({ name: 'reporte_semanal_manual' })

  void generarYEnviarReportes(llm, sender)
    .then(({ procesadas, errores }) => {
      trace.event({ name: 'completado', output: { procesadas, errores } })
    })
    .catch((err: unknown) => {
      trace.event({ name: 'error', level: 'ERROR', output: { error: String(err) } })
      console.error('[reportes] Error en trigger manual:', err)
    })

  return c.json({ status: 'triggered' }, 202)
})

// Cron: lunes 8:00am hora Ecuador (UTC-5 = 13:00 UTC)
// Expresión: minuto hora * * día_semana  →  0 13 * * 1
cron.schedule('0 13 * * 1', () => {
  const trace = langfuse.trace({ name: 'reporte_semanal_cron' })
  console.log('[cron] Iniciando reportes semanales')
  generarYEnviarReportes(llm, sender)
    .then(({ procesadas, errores }) => {
      trace.event({ name: 'completado', output: { procesadas, errores } })
      console.log(`[cron] Reportes completados: ${procesadas} enviados, ${errores} errores`)
    })
    .catch((err: unknown) => {
      trace.event({ name: 'error', level: 'ERROR', output: { error: String(err) } })
      console.error('[cron] Error en reportes semanales:', err)
    })
}, { timezone: 'UTC' })

export { llm }

serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })
