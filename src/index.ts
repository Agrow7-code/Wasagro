import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import cron from 'node-cron'
import { webhookRouter, inicializarRouter } from './webhook/router.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from './integrations/whatsapp/index.js'
import { crearLLM } from './integrations/llm/index.js'
import { inicializarPipeline } from './pipeline/procesarMensajeEntrante.js'
import { generarYEnviarReportes } from './pipeline/reporteSemanal.js'
import { enviarAlertasClima } from './pipeline/alertaClima.js'
import { enviarAlertasPrecio } from './pipeline/alertaPrecio.js'
import { langfuse } from './integrations/langfuse.js'
import { initPgBoss } from './workers/pgBoss.js'

import { authRouter } from './auth/router.js'

// ── Startup env var validation ────────────────────────────────────────────────
function validarEnvVars(): void {
  const provider = process.env['WHATSAPP_PROVIDER']
  const llmProvider = process.env['WASAGRO_LLM']

  const criticas: string[] = []

  if (!process.env['SUPABASE_URL']) criticas.push('SUPABASE_URL')
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) criticas.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env['DATABASE_URL']) criticas.push('DATABASE_URL')
  if (!llmProvider) criticas.push('WASAGRO_LLM')
  if (!provider) criticas.push('WHATSAPP_PROVIDER')

  if (llmProvider === 'gemini' && !process.env['GEMINI_API_KEY']) criticas.push('GEMINI_API_KEY')

  if (provider === 'meta') {
    if (!process.env['WHATSAPP_PHONE_NUMBER_ID']) criticas.push('WHATSAPP_PHONE_NUMBER_ID')
    if (!process.env['WHATSAPP_ACCESS_TOKEN']) criticas.push('WHATSAPP_ACCESS_TOKEN')
    if (!process.env['WHATSAPP_APP_SECRET']) criticas.push('WHATSAPP_APP_SECRET')
  } else if (provider === 'evolution') {
    if (!process.env['EVOLUTION_API_URL']) criticas.push('EVOLUTION_API_URL')
    if (!process.env['EVOLUTION_API_KEY']) criticas.push('EVOLUTION_API_KEY')
    if (!process.env['EVOLUTION_INSTANCE']) criticas.push('EVOLUTION_INSTANCE')
    if (!process.env['WHATSAPP_APP_SECRET']) criticas.push('WHATSAPP_APP_SECRET')
  }

  if (criticas.length > 0) {
    console.error('[startup] Variables de entorno críticas faltantes:', criticas.join(', '))
    process.exit(1)
  }

  const opcionales: [string, string][] = [
    ['DEMO_BOOKING_URL', 'sin esta variable no se podrán enviar links de demo'],
    ['REPORTE_SECRET', 'el endpoint /reportes/semanal no estará protegido'],
    ['LANGFUSE_SECRET_KEY', 'sin observabilidad LangFuse'],
    ['LANGFUSE_PUBLIC_KEY', 'sin observabilidad LangFuse'],
  ]

  for (const [k, hint] of opcionales) {
    if (!process.env[k]) console.warn(`[startup] ${k} no configurado — ${hint}`)
  }
}

validarEnvVars()

const adapter = crearAdapterWhatsApp()
const sender = crearSenderWhatsApp()
const llm = crearLLM()

inicializarRouter(adapter)
inicializarPipeline(sender, llm)

// ── Startup background services (only for standalone server, not Vercel) ─────
if (!process.env['VERCEL']) {
  await initPgBoss()

  // Cron: lunes 8:00am hora Ecuador (UTC-5 = 13:00 UTC)
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

  // Cron: alertas de clima diarias — 6am Ecuador (UTC-5) = 11:00 UTC
  cron.schedule('0 11 * * *', () => {
    const trace = langfuse.trace({ name: 'alertas_clima_cron' })
    enviarAlertasClima(sender)
      .then(({ enviadas, errores }) => {
        trace.event({ name: 'completado', output: { enviadas, errores } })
        console.log(`[cron] Alertas clima: ${enviadas} enviadas, ${errores} errores`)
      })
      .catch((err: unknown) => {
        trace.event({ name: 'error', level: 'ERROR', output: { error: String(err) } })
        console.error('[cron] Error en alertas de clima:', err)
      })
  }, { timezone: 'UTC' })

  // Cron: alerta de precio de banano — lunes 6am Ecuador = 11:00 UTC (mismo slot que reportes)
  cron.schedule('30 11 * * 1', () => {
    const trace = langfuse.trace({ name: 'alertas_precio_cron' })
    enviarAlertasPrecio(sender)
      .then(({ enviadas, errores }) => {
        trace.event({ name: 'completado', output: { enviadas, errores } })
        console.log(`[cron] Alertas precio: ${enviadas} enviadas, ${errores} errores`)
      })
      .catch((err: unknown) => {
        trace.event({ name: 'error', level: 'ERROR', output: { error: String(err) } })
        console.error('[cron] Error en alertas de precio:', err)
      })
  }, { timezone: 'UTC' })
}

const app = new Hono()

app.get('/health', (c) => c.json({
  status: 'ok',
  provider: process.env['WHATSAPP_PROVIDER'],
  llm: process.env['WASAGRO_LLM'],
}))

app.route('/webhook', webhookRouter)
app.route('/auth', authRouter)

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

// POST /alertas/clima — trigger manual de alertas de clima (protegido por secret)
app.post('/alertas/clima', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  if (!secret || secret !== process.env['REPORTE_SECRET']) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const trace = langfuse.trace({ name: 'alertas_clima_manual' })
  void enviarAlertasClima(sender)
    .then(({ enviadas, errores }) => {
      trace.event({ name: 'completado', output: { enviadas, errores } })
    })
    .catch((err: unknown) => {
      trace.event({ name: 'error', level: 'ERROR', output: { error: String(err) } })
      console.error('[alertas] Error en trigger manual:', err)
    })

  return c.json({ status: 'triggered' }, 202)
})

export { app, llm }

if (process.env['NODE_ENV'] !== 'test') {
  serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })
}
