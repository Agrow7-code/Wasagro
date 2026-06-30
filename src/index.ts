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
import { getCorreccionesParaEval, getEventoSigatokaById } from './pipeline/supabaseQueries.js'
import { analizarCorrecciones, compararMuestreos, distribucionEstados } from './pipeline/sigatokaEval.js'
import { getSignedUrlEvento } from './integrations/supabaseStorage.js'
import { PromptManager } from './pipeline/promptManager.js'
import { langfuse } from './integrations/langfuse.js'
import { initPgBoss, isPgBossReady } from './workers/pgBoss.js'

import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { authRouter } from './auth/router.js'
import { authMiddleware } from './auth/middleware.js'
import { planGuard } from './auth/planGuard.js'
import { rateLimiter } from './auth/rateLimiter.js'
import { createPayment, confirmPayment, getSmartFieldsApiKey } from './integrations/dlocal/dlocalClient.js'
import { handleDLocalGoWebhook } from './integrations/dlocal/dlocalWebhookHandler.js'
import { handleDeUnaWebhook } from './integrations/deuna/deunaClient.js'
import { verifyHmacSignature, verifySharedToken } from './integrations/webhookSecurity.js'
import { calcularPrecio, getBasePrice, getSegmentLabel, inferPlanSegment, isPaidPlan, PRICE_PER_FINCA, PRICE_PER_USER } from './auth/pricingUtils.js'
import { metricasRouter } from './agents/metricas/router.js'
import { fincaRouter } from './agents/finca/router.js'
import { createProvisionHandler } from './agents/provisioning/provisionarCliente.js'
import { adminRouter } from './agents/admin/router.js'
import { roleGuard } from './auth/roleGuard.js'

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
    ['DLOCALGO_WEBHOOK_SECRET', 'el webhook de dLocal Go RECHAZARÁ todas las peticiones (503) hasta configurarlo'],
    ['DEUNA_WEBHOOK_SECRET', 'el webhook de DeUna RECHAZARÁ todas las peticiones (503) hasta configurarlo'],
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

// Logger para depuración en Vercel.
// Solo el pathname: el query string puede llevar secretos (ej. el token del
// webhook de pago viaja en notification_url) y no debe quedar en stdout.
app.use('*', async (c, next) => {
  const start = Date.now()
  let safePath: string
  try { safePath = new URL(c.req.url).pathname } catch { safePath = c.req.path }
  console.log(`[Request] ${c.req.method} ${safePath}`)
  await next()
  console.log(`[Response] ${c.req.method} ${safePath} - ${c.res.status} (${Date.now() - start}ms)`)
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
app.use('/auth/*', rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10, failClosed: true }))
app.use('/api/auth/*', rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10, failClosed: true }))
app.route('/auth', authRouter)
app.route('/api/auth', authRouter)
app.route('/api/webhook', webhookRouter)

// ── Admin back-office (D28) — director-only, NO planGuard ──────────────────
// DO NOT add planGuard here — admin must never be blocked by the director's own billing status.
app.use('/api/admin/*', authMiddleware)
app.use('/api/admin/*', roleGuard)
app.use('/api/admin/*', rateLimiter({ windowMs: 60_000, maxRequests: 60 }))
app.route('/api/admin', adminRouter)

app.use('/api/metricas/*', authMiddleware)
app.use('/api/finca/*', authMiddleware)
app.use('/api/metricas/*', planGuard)
app.use('/api/finca/*', planGuard)
app.use('/api/*', rateLimiter({ windowMs: 60 * 1000, maxRequests: 60 }))
app.route('/api/metricas', metricasRouter)
app.route('/api/finca', fincaRouter)

// ── Billing routes (dLocal Go) ──────────────────────────────────────────────
app.get('/api/billing/calculate-price', (c) => {
  const fincas = Number(c.req.query('fincas')) || 1
  const usuarios = Number(c.req.query('usuarios')) || 1
  if (fincas < 1 || usuarios < 1) return c.json({ error: 'fincas y usuarios deben ser >= 1' }, 400)
  const base = getBasePrice(fincas, usuarios)
  const total = calcularPrecio(fincas, usuarios)
  return c.json({
    base,
    fincas_cost: PRICE_PER_FINCA * fincas,
    usuarios_cost: PRICE_PER_USER * usuarios,
    total,
    segment: getSegmentLabel(fincas, usuarios),
    plan: inferPlanSegment(fincas, usuarios),
  })
})

app.get('/api/billing/smartfields-key', authMiddleware, (c) => {
  try {
    const key = getSmartFieldsApiKey()
    return c.json({ key })
  } catch {
    return c.json({ error: 'dLocal Go SmartFields no configurado' }, 503)
  }
})

app.post('/api/billing/create-payment', authMiddleware, async (c) => {
    const user = c.get('authedUser')
    if (!user) return c.json({ error: 'No autenticado' }, 401)

    const body = await c.req.json().catch(() => ({}))
    const fincas = Number(body.fincas) || 1
    const usuarios = Number(body.usuarios) || 1
    const bodyCountry = body.country as string | undefined

    if (fincas < 1 || usuarios < 1) {
      return c.json({ error: 'fincas y usuarios deben ser >= 1' }, 400)
    }

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)

    let country = bodyCountry ?? 'EC'
    if (!bodyCountry) {
      const { data: org } = await supabase
        .from('organizaciones')
        .select('pais')
        .eq('org_id', usuario.org_id)
        .single()
      if (org?.pais) country = org.pais
    }

    try {
      const result = await createPayment(usuario.org_id, fincas, usuarios, country)
      return c.json({
        payment_id: result.id,
        merchant_checkout_token: result.merchant_checkout_token,
        amount: result.amount,
        segment: inferPlanSegment(fincas, usuarios),
      })
    } catch (err: any) {
      console.error('[billing] Error creating dLocal Go payment:', err.message)
      return c.json({ error: 'Error creando el pago' }, 500)
    }
  })

app.post('/api/billing/confirm-payment', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const checkoutToken = body.checkout_token as string | undefined
  const cardToken = body.card_token as string | undefined
  const firstName = body.first_name as string | undefined
  const lastName = body.last_name as string | undefined
  const documentType = body.document_type as string | undefined
  const document = body.document as string | undefined
  const email = body.email as string | undefined

  if (!checkoutToken) return c.json({ error: 'checkout_token requerido' }, 400)
  if (!cardToken) return c.json({ error: 'card_token requerido (SmartFields token)' }, 400)
  if (!firstName || !lastName || !documentType || !document || !email) {
    return c.json({ error: 'first_name, last_name, document_type, document, email requeridos' }, 400)
  }

  try {
    const result = await confirmPayment(checkoutToken, cardToken, firstName, lastName, documentType, document, email)
    return c.json({ payment_id: result.id, status: result.status, status_code: result.status_code })
  } catch (err: any) {
    console.error('[billing] Error confirming dLocal Go payment:', err.message)
    return c.json({ error: 'Error confirmando el pago' }, 500)
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
    await supabase
      .from('organizaciones')
      .update({
        subscription_status: 'canceled',
        plan_cancelado_en: new Date().toISOString(),
        dlocalgo_checkout_token: null,
      })
      .eq('org_id', usuario.org_id)

    return c.json({ status: 'canceled' })
  } catch (err: any) {
    console.error('[billing] Error cancelando:', err.message)
    return c.json({ error: 'Error cancelando suscripción' }, 500)
  }
})

app.post('/api/billing/change-plan', authMiddleware, async (c) => {
  const user = c.get('authedUser')
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id, rol')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) return c.json({ error: 'Usuario sin organización' }, 403)
  if (!['admin_org', 'director', 'propietario'].includes(usuario.rol)) {
    return c.json({ error: 'Solo un administrador puede cambiar el plan' }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  const fincas = Number(body.fincas)
  const usuarios = Number(body.usuarios)

  if (!fincas || fincas < 1 || !usuarios || usuarios < 1) {
    return c.json({ error: 'fincas y usuarios deben ser >= 1' }, 400)
  }

  const newPlan = inferPlanSegment(fincas, usuarios)
  const newPrice = calcularPrecio(fincas, usuarios)

  try {
    const { error } = await supabase
      .from('organizaciones')
      .update({
        fincas_contratadas: fincas,
        usuarios_contratados: usuarios,
        precio_mensual: newPrice,
        plan: newPlan,
      })
      .eq('org_id', usuario.org_id)

    if (error) throw error

    return c.json({
      plan: newPlan,
      fincas_contratadas: fincas,
      usuarios_contratados: usuarios,
      precio_mensual: newPrice,
      segment_label: getSegmentLabel(fincas, usuarios),
    })
  } catch (err: any) {
    console.error('[billing] Error changing plan:', err.message)
    return c.json({ error: 'Error cambiando el plan' }, 500)
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
      .select('org_id, nombre, plan, pais, trial_inicio, trial_fin, subscription_status, metodo_pago, plan_activo_desde, plan_cancelado_en, fincas_contratadas, usuarios_contratados, precio_mensual')
      .eq('org_id', usuario.org_id)
      .single()

    if (!org) return c.json({ error: 'Organización no encontrada' }, 404)

    const segmentLabel = isPaidPlan(org.plan) ? getSegmentLabel(org.fincas_contratadas, org.usuarios_contratados) : org.plan

    return c.json({ ...org, segment_label: segmentLabel })
})

app.post('/api/billing/dlocalgo-webhook', bodyLimit({ maxSize: 65_536 }), async (c) => {
  // Verificación obligatoria: sin esto cualquiera podría forjar el estado de
  // suscripción de cualquier organización (activar gratis / cancelar a un cliente).
  const secret = process.env['DLOCALGO_WEBHOOK_SECRET']
  if (!secret) {
    console.error('[dlocalgo-webhook] RECHAZADO: DLOCALGO_WEBHOOK_SECRET no configurado')
    return c.json({ error: 'Webhook no configurado' }, 503)
  }

  const rawBody = await c.req.text()
  const token = c.req.query('token') ?? c.req.header('x-webhook-token')
  const signature = c.req.header('x-dlocalgo-signature') ?? c.req.header('x-signature')
  const ok = verifySharedToken(token, secret) || verifyHmacSignature(rawBody, signature, secret)
  if (!ok) {
    console.warn('[dlocalgo-webhook] firma/token inválido — rechazado')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const payload = JSON.parse(rawBody)
    await handleDLocalGoWebhook(payload)
    return c.json({ received: true })
  } catch (err: any) {
    console.error('[dlocalgo-webhook] Error:', err.message)
    return c.json({ error: 'Webhook processing failed' }, 400)
  }
})

// DeUna webhook — verificación obligatoria (HMAC sobre body raw o token compartido)
app.post('/api/billing/deuna-webhook', bodyLimit({ maxSize: 65_536 }), async (c) => {
  const secret = process.env['DEUNA_WEBHOOK_SECRET']
  if (!secret) {
    console.error('[deuna-webhook] RECHAZADO: DEUNA_WEBHOOK_SECRET no configurado')
    return c.json({ error: 'Webhook no configurado' }, 503)
  }

  const rawBody = await c.req.text()
  const token = c.req.query('token') ?? c.req.header('x-webhook-token')
  const signature = c.req.header('x-deuna-signature') ?? c.req.header('x-signature')
  const ok = verifySharedToken(token, secret) || verifyHmacSignature(rawBody, signature, secret)
  if (!ok) {
    console.warn('[deuna-webhook] firma/token inválido — rechazado')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const payload = JSON.parse(rawBody)
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

// GET /sigatoka/eval — reporte de calidad de extracción Sigatoka (CR5/D32).
// Mide DÓNDE falla la extracción con las correcciones humanas guardadas:
// errores confiados (modelo leyó y erró, sin avisar) vs ilegibles completados,
// por sección (matriz / 11sem / 00sem). Read-only, protegido por REPORTE_SECRET.
// Query opcional ?evento_id=... para acotar a un muestreo.
app.get('/sigatoka/eval', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  const expected = process.env['REPORTE_SECRET']
  if (!secret || !expected || !secureSecretCompare(secret, expected)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const eventoId = c.req.query('evento_id') || undefined
  try {
    const rows = await getCorreccionesParaEval(eventoId)
    const eventos = [...new Set(rows.map(r => r.evento_id))]
    return c.json({ muestras: rows.length, evento_id: eventoId ?? null, eventos, reporte: analizarCorrecciones(rows) })
  } catch (err) {
    console.error('[sigatoka/eval] error:', err)
    return c.json({ error: err instanceof Error ? err.message : 'error interno' }, 500)
  }
})

// GET /sigatoka/prompt-check?name=... — diagnóstico INSTANTÁNEO: muestra qué
// prompt está usando el agente AHORA (vía PromptManager, igual que la extracción),
// para confirmar si la versión calibrada está viva o si Langfuse sirve la vieja.
app.get('/sigatoka/prompt-check', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  const expected = process.env['REPORTE_SECRET']
  if (!secret || !expected || !secureSecretCompare(secret, expected)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const name = c.req.query('name') ?? 'sp-03e2b-sigatoka-00sem.md'
  try {
    const live = await PromptManager.getPrompt(name, `prompts/${name}`)
    // Marcador a prueba de markdown/saltos: la palabra HONESTIDAD solo está en la
    // versión calibrada (la vieja no la tiene). Robusto a ** y wrapping.
    const calibrado = /HONESTIDAD/i.test(live) || /\bTENUE\b/i.test(live)
    return c.json({ name, calibrado, length: live.length, head: live.slice(0, 200) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})

// GET /sigatoka/reextract?evento_id=... — loop de re-extracción (CR5/D32).
// Re-corre la extracción sobre la imagen GUARDADA del muestreo y la compara,
// celda por celda, contra el muestreo ya corregido (ground-truth). Mide si un
// cambio de prompt/región baja los errores. Read-only (no modifica el evento),
// pero CONSUME llamadas LLM (re-corre el pipeline). Protegido por REPORTE_SECRET.
app.get('/sigatoka/reextract', async (c) => {
  const secret = c.req.header('x-reporte-secret')
  const expected = process.env['REPORTE_SECRET']
  if (!secret || !expected || !secureSecretCompare(secret, expected)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const eventoId = c.req.query('evento_id')
  if (!eventoId) return c.json({ error: 'evento_id requerido' }, 400)
  try {
    const evento = await getEventoSigatokaById(eventoId)
    if (!evento) return c.json({ error: 'evento no encontrado' }, 404)
    const groundTruth = (evento.datos_evento as Record<string, unknown>)?.['sigatoka']
    if (!groundTruth) return c.json({ error: 'el evento no tiene muestreo sigatoka' }, 422)
    if (!evento.imagen_path) return c.json({ error: 'el evento no tiene imagen guardada' }, 422)

    const url = await getSignedUrlEvento(evento.imagen_path)
    if (!url) return c.json({ error: 'no se pudo firmar la URL de la imagen' }, 500)
    const imgRes = await fetch(url)
    if (!imgRes.ok) return c.json({ error: `descarga de imagen falló: ${imgRes.status}` }, 502)
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
    const mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg'

    const nuevo = await llm.extraerMuestreoSigatoka(base64, mimeType, `reextract-${eventoId}-${Date.now()}`)
    const nuevoComp = nuevo as unknown as Parameters<typeof compararMuestreos>[0]
    const reporte = compararMuestreos(nuevoComp, groundTruth as Parameters<typeof compararMuestreos>[1])
    // Métrica de calibración ROBUSTA (no depende de alinear filas con el ground-truth):
    // distribución de estados de la extracción fresca. Si la calibración del 00sem
    // funciona, sem00.ilegible debe SUBIR (el modelo admite duda en vez de adivinar).
    const distribucion = distribucionEstados(nuevoComp)
    return c.json({
      evento_id: eventoId,
      calibracion: { sem00: distribucion.sem00, sem11: distribucion.sem11 }, // ← mirá sem00.ilegible
      resumen: {
        celdasMal: reporte.totalCeldasMal,
        silenciosas: reporte.totalSilenciosas,
        filasFaltantes: reporte.totalFilasFaltantes,
        nota: 'el 00sem sin numeros de fila desalinea la comparacion contra ground-truth; para calibracion mira `calibracion.sem00.ilegible`',
      },
      reporte,
    })
  } catch (err) {
    console.error('[sigatoka/reextract] error:', err)
    return c.json({ error: err instanceof Error ? err.message : 'error interno' }, 500)
  }
})

// POST /internal/provision-client — atomic client provisioning (D33).
// Uses createProvisionHandler factory so the test suite exercises the same handler
// code as production (no test-fidelity drift, no logic duplication).
//
// Trace adapter: ProvisionDeps.trace uses positional (name, body) arguments while
// LangFuse uses object-param API { name, metadata }. createProvisionHandler accepts
// an optional per-request trace factory via the ProvisionHandlerDeps interface.
// Here we pass no static trace — each request creates its own LangFuse trace inside
// a thin wrapper registered after the handler's auth+validate steps.
//
// Because createProvisionHandler only accepts a static trace in ProvisionHandlerDeps,
// and LangFuse traces must be per-request, we register two middlewares: the factory
// handler for auth+validate+dispatch, and a separate catcher for observability.
// Alternatively: the factory receives an optional trace factory function.
// For simplicity and to avoid over-engineering, we wrap the handler with per-request
// trace injection using a thin outer handler.
app.post('/internal/provision-client', async (c) => {
  const lfTrace = langfuse.trace({ name: 'provision_client' })
  // Adapter: ProvisionTrace positional (name, body) → LangFuse object-param API
  const traceAdapter = {
    event: (name: string, body?: unknown) =>
      lfTrace.event({ name, metadata: body as Record<string, unknown> | undefined }),
  }
  return createProvisionHandler({
    secret: process.env['REPORTE_SECRET'] ?? '',
    trace: traceAdapter,
  })(c)
})

export { app, llm }

if (process.env['NODE_ENV'] !== 'test') {
  serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })
}
