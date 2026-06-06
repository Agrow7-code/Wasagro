import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import cron from 'node-cron'
import { webhookRouter, inicializarRouter } from './webhook/router.js'
import { crearAdapterWhatsApp, crearSenderWhatsApp } from './integrations/whatsapp/index.js'
import { crearLLM, crearAdapterLLM } from './integrations/llm/index.js'
import { crearEmbeddingService } from './integrations/llm/EmbeddingService.js'
import { RAGRetriever } from './agents/rag/RAGRetriever.js'
import { inicializarPipeline } from './pipeline/procesarMensajeEntrante.js'
import { supabase } from './integrations/supabase.js'
import { generarYEnviarReportes } from './pipeline/reporteSemanal.js'
import { enviarAlertasClima } from './pipeline/alertaClima.js'
import { enviarAlertasPrecio } from './pipeline/alertaPrecio.js'
import { langfuse } from './integrations/langfuse.js'
import { initPgBoss, isPgBossReady } from './workers/pgBoss.js'

import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { authRouter } from './auth/router.js'
import { authMiddleware } from './auth/middleware.js'
import { planGuard } from './auth/planGuard.js'
import { rateLimiter } from './auth/rateLimiter.js'
import { createCheckoutSession, createCustomerPortalSession, cancelSubscription } from './integrations/stripe/checkoutService.js'
import { verifyWebhookSignature, handleStripeWebhook } from './integrations/stripe/stripeWebhookHandler.js'
import { handleDeUnaWebhook } from './integrations/deuna/deunaClient.js'
import { metricasRouter } from './agents/metricas/router.js'
import { fincaRouter } from './agents/finca/router.js'

// ── Startup env var validation ────────────────────────────────────────────────
function validarEnvVars(): void {
  const provider = process.env['WHATSAPP_PROVIDER']
  const llmProvider = process.env['WASAGRO_LLM']

  const criticas: string[] = []

  if (!process.env['SUPABASE_URL']) criticas.push('SUPABASE_URL')
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) criticas.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env['DATABASE_URL']) criticas.push('DATABASE_URL')
  if (!process.env['JWT_SECRET']) criticas.push('JWT_SECRET')
  if (!process.env['REPORTE_SECRET']) criticas.push('REPORTE_SECRET')
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
    if (!process.env['EVOLUTION_WEBHOOK_SECRET']) criticas.push('EVOLUTION_WEBHOOK_SECRET')
  }

  if (criticas.length > 0) {
    console.error('[startup] Variables de entorno críticas faltantes:', criticas.join(', '))
    process.exit(1)
  }

  const opcionales: [string, string][] = [
    ['CALCOM_BOOKING_URL', 'sin esta variable no se podrán enviar links de demo (Cal.com)'],
    ['CALCOM_WEBHOOK_SECRET', 'sin esta variable el webhook de Cal.com rechazará todas las peticiones'],
    ['CALCOM_API_KEY', 'sin esta variable no se puede crear/consultar bookings via API'],
    ['FOUNDER_PHONE', 'sin esta variable no se notificará al founder por WhatsApp cuando se confirme un booking'],
    ['FOUNDER_EMAIL', 'sin esta variable no se notificará al founder por email (fallback: wasagro@proton.me)'],
    ['DEMO_BOOKING_URL', 'fallback si CALCOM_BOOKING_URL no está configurado (link estático de Calendly)'],
    ['SUPABASE_ANON_KEY', 'endpoints autenticados usarán service_role en vez de RLS'],
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
const llmAdapter = crearAdapterLLM()
const llm = crearLLM(llmAdapter)

const embeddingService = crearEmbeddingService() ?? undefined
const ragRetriever = embeddingService ? new RAGRetriever(embeddingService, supabase) : undefined

inicializarRouter(adapter)
inicializarPipeline(sender, llm, {
  adapter: llmAdapter,
  ...(embeddingService ? { embeddingService } : {}),
  ...(ragRetriever ? { ragRetriever } : {}),
})

// ── Startup background services (only for standalone server, not Vercel) ─────
if (!process.env['VERCEL']) {
  await initPgBoss().catch(err => console.error('[pg-boss] Error init:', err))

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

function secureSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(String(a))
  const bBuf = Buffer.from(String(b))
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

// Logger para depuración en Vercel
app.use('*', async (c, next) => {
  const start = Date.now()
  console.log(`[Request] ${c.req.method} ${c.req.url}`)
  await next()
  console.log(`[Response] ${c.req.method} ${c.req.url} - ${c.res.status} (${Date.now() - start}ms)`)
})

const previewOriginRe = /^https:\/\/wasagro-.*\.vercel\.app$/

app.use('*', cors({
  origin: (origin) => {
    if (!origin || origin === 'https://wasagro.vercel.app' || origin === 'http://localhost:5173' || previewOriginRe.test(origin)) return origin
    return ''
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-XSS-Protection', '0')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  // COEP=unsafe-none — this is a JSON API, not an HTML doc; require-corp adds
  // no protection here and can break legitimate cross-origin embedding by clients.
  c.header('Cross-Origin-Embedder-Policy', 'unsafe-none')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
})

// Body size limit — protect against memory exhaustion DoS.
// 1MB is generous for JSON payloads (webhooks include URLs + text, not binary).
app.use('*', bodyLimit({
  maxSize: 1 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Body too large' }, 413),
}))

app.get('/health', (c) => c.json({
  status: 'ok',
  uptime: process.uptime(),
  pgboss: isPgBossReady() ? 'ready' : 'not_ready',
  provider: process.env['WHATSAPP_PROVIDER'] ?? 'unset',
  llm: process.env['WASAGRO_LLM'] ?? 'unset',
}))

app.route('/webhook', webhookRouter)
app.use('/auth/*', rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }))
app.use('/api/auth/*', rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 }))
app.route('/auth', authRouter)
app.route('/api/auth', authRouter)
app.route('/api/webhook', webhookRouter)

app.use('/api/metricas/*', authMiddleware)
app.use('/api/finca/*', authMiddleware)
app.use('/api/metricas/*', planGuard)
app.use('/api/finca/*', planGuard)
app.use('/api/*', rateLimiter({ windowMs: 60 * 1000, maxRequests: 60 }))
app.route('/api/metricas', metricasRouter)
app.route('/api/finca', fincaRouter)

// ── Billing routes ──────────────────────────────────────────────────────────
app.post('/api/billing/checkout', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const plan = body.plan as 'starter' | 'enterprise' | undefined
  if (!plan || !['starter', 'enterprise'].includes(plan)) {
    return c.json({ error: 'plan debe ser starter o enterprise' }, 400)
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)

  try {
    const result = await createCheckoutSession(usuario.org_id, plan)
    return c.json({ url: result.url })
  } catch (err: any) {
    console.error('[billing] Error creando checkout:', err.message)
    return c.json({ error: 'Error creando sesión de pago' }, 500)
  }
})

app.post('/api/billing/portal', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)

  try {
    const url = await createCustomerPortalSession(usuario.org_id)
    return c.json({ url })
  } catch (err: any) {
    console.error('[billing] Error creando portal:', err.message)
    return c.json({ error: 'Error abriendo portal de pagos' }, 500)
  }
})

app.post('/api/billing/cancel', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)

  try {
    await cancelSubscription(usuario.org_id)
    return c.json({ status: 'canceled' })
  } catch (err: any) {
    console.error('[billing] Error cancelando:', err.message)
    return c.json({ error: 'Error cancelando suscripción' }, 500)
  }
})

app.get('/api/billing/status', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)

  const { data: org } = await supabase
    .from('organizaciones')
    .select('org_id, nombre, plan, trial_inicio, trial_fin, subscription_status, metodo_pago, plan_activo_desde, plan_cancelado_en')
    .eq('org_id', usuario.org_id)
    .single()

  if (!org) return c.json({ error: 'Organización no encontrada' }, 404)
  return c.json(org)
})

// Stripe webhook — no auth (Stripe signs with webhook secret)
app.post('/api/billing/stripe-webhook', bodyLimit({ maxSize: 65_536 }), async (c) => {
  const sig = c.req.header('stripe-signature')
  if (!sig) return c.json({ error: 'Firma Stripe faltante' }, 400)

  try {
    const rawBody = await c.req.text()
    const event = verifyWebhookSignature(rawBody, sig)
    await handleStripeWebhook(event)
    return c.json({ received: true })
  } catch (err: any) {
    console.error('[stripe-webhook] Error:', err.message)
    return c.json({ error: 'Webhook signature verification failed' }, 400)
  }
})

// DeUna webhook — no auth (verify via signature header if DeUna provides one)
app.post('/api/billing/deuna-webhook', bodyLimit({ maxSize: 65_536 }), async (c) => {
  try {
    const payload = await c.req.json()
    await handleDeUnaWebhook(payload)
    return c.json({ received: true })
  } catch (err: any) {
    console.error('[deuna-webhook] Error:', err.message)
    return c.json({ error: 'Webhook processing failed' }, 400)
  }
})

// POST /reportes/semanal — trigger manual de reportes (protegido por secret)
app.post('/reportes/semanal', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  const expected = process.env['REPORTE_SECRET']
  if (!secret || !expected || !secureSecretCompare(secret, expected)) {
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
  const expected = process.env['REPORTE_SECRET']
  if (!secret || !expected || !secureSecretCompare(secret, expected)) {
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
