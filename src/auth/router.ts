import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'
import { langfuse } from '../integrations/langfuse.js'
import { isPgBossReady, getBoss } from '../workers/pgBoss.js'

export const authRouter = new Hono()

authRouter.post('/request-otp', async (c) => {
  const { phone } = await c.req.json()
  if (!phone) return c.json({ error: 'Número de teléfono requerido' }, 400)

  const trace = langfuse.trace({ name: 'auth_request_otp', input: { phone } })

  try {
    const usuario = await getUserByPhone(phone)
    if (!usuario) {
      trace.event({ name: 'user_not_found', level: 'WARNING' })
      return c.json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' }, 404)
    }

    const code = await requestOTP(phone)

    // Responder al frontend INMEDIATAMENTE.
    // El envío por WhatsApp se hace en background (pg-boss si está disponible,
    // o fire-and-forget en serverless donde no hay proceso persistente).
    // Si el envío falla, el usuario puede pedir reenvío desde el step OTP.
    if (isPgBossReady()) {
      getBoss().send('enviar-otp-whatsapp', { phone, code, traceId: trace.id }, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 300,
      }).then(() => {
        trace.event({ name: 'otp_queued', output: { via: 'pg-boss' } })
      }).catch((err: unknown) => {
        console.error('[auth] Error enqueuing OTP job:', err)
        trace.event({ name: 'otp_queue_failed', level: 'ERROR', output: { error: String(err) } })
      })
    } else {
      sendOTPViaWhatsApp(phone, code)
        .then(() => {
          trace.event({ name: 'otp_sent_direct', output: { via: 'direct' } })
          console.log(`[auth] OTP enviado a ${phone.slice(-4)}***`)
        })
        .catch((err: unknown) => {
          console.error(`[auth] Error enviando OTP a ${phone.slice(-4)}***:`, err)
          trace.event({ name: 'otp_send_failed', level: 'ERROR', output: { error: String(err) } })
        })
    }

    return c.json({ status: 'sent' })
  } catch (err: any) {
    trace.event({ name: 'error', level: 'ERROR', output: { error: err.message } })
    return c.json({ error: err.message }, 500)
  }
})

authRouter.post('/verify-otp', async (c) => {
  const { phone, code } = await c.req.json()
  if (!phone || !code) return c.json({ error: 'Teléfono y código requeridos' }, 400)

  const trace = langfuse.trace({ name: 'auth_verify_otp', input: { phone } })

  try {
    const result = await verifyOTP(phone, code)
    if (!result.success) {
      trace.event({ name: 'verification_failed', level: 'WARNING', output: { error: result.error } })
      return c.json({ error: result.error }, 401)
    }

    // Obtener usuario completo
    const usuario = await getUserByPhone(phone)
    if (!usuario) return c.json({ error: 'Usuario no encontrado tras verificación' }, 404)

    trace.event({ name: 'verification_success', output: { rol: usuario.rol } })
    
    // Aquí podrías generar un JWT si tuvieras una secret configurada. 
    // Por ahora, devolvemos el usuario para que el frontend lo guarde.
    return c.json({ 
      user: {
        id: usuario.id,
        phone: usuario.phone,
        rol: usuario.rol,
        nombre: usuario.nombre
      }
    })
  } catch (err: any) {
    trace.event({ name: 'error', level: 'ERROR', output: { error: err.message } })
    return c.json({ error: err.message }, 500)
  }
})
