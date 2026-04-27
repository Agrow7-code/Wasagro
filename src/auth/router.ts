import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'
import { isPgBossReady, getBoss } from '../workers/pgBoss.js'

export const authRouter = new Hono()

authRouter.get('/ping', (c) => c.json({ status: 'pong' }))

authRouter.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
  
  if (!phone) return c.json({ error: 'Número de teléfono requerido' }, 400)

  try {
    // 1. DB Lookup con timeout forzado de 5s para evitar el 504 de Vercel
    const usuarioPromise = getUserByPhone(phone)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT_DB')), 5000)
    )
    
    const usuario = await Promise.race([usuarioPromise, timeoutPromise]) as any
    if (!usuario) return c.json({ error: 'Número no registrado' }, 404)

    // 2. Generar OTP
    const code = await requestOTP(phone)

    // 3. Envío de WhatsApp (DESACOPLADO TOTALMENTE vía waitUntil)
    // Esto le dice a Vercel: "Responde al cliente YA, pero deja este proceso vivo para enviar el mensaje"
    const taskEnvio = (async () => {
      try {
        if (isPgBossReady()) {
          await getBoss().send('enviar-otp-whatsapp', { phone, code, traceId: 'no-trace' })
        } else {
          await sendOTPViaWhatsApp(phone, code)
        }
      } catch (e) {
        console.error('[auth] Error diferido WhatsApp:', e)
      }
    })()

    // Si estamos en Vercel, usamos su mecanismo oficial de background tasks
    if (c.executionCtx) {
      c.executionCtx.waitUntil(taskEnvio)
    }

    // 4. Responder inmediatamente
    return c.json({ status: 'sent' })

  } catch (err: any) {
    console.error(`[auth] Error en request-otp:`, err.message)
    const msg = err.message === 'TIMEOUT_DB' 
      ? 'La base de datos está lenta, intenta de nuevo.' 
      : 'Error interno del servidor'
    return c.json({ error: msg }, 500)
  }
})

authRouter.post('/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
  const { code } = body

  if (!phone || !code) return c.json({ error: 'Faltan datos' }, 400)

  try {
    const result = await verifyOTP(phone, code)
    if (!result.success) return c.json({ error: result.error }, 401)

    const usuario = await getUserByPhone(phone)
    return c.json({ 
      user: {
        id: usuario?.id,
        phone: usuario?.phone,
        rol: usuario?.rol,
        nombre: usuario?.nombre
      }
    })
  } catch (err: any) {
    return c.json({ error: 'Error al verificar' }, 500)
  }
})
