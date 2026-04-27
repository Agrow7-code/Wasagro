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
    // 1. Verificar usuario existe (con timeout implícito por el supabase client)
    const usuario = await getUserByPhone(phone)
    if (!usuario) {
      trace.event({ name: 'user_not_found', level: 'WARNING' })
      return c.json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' }, 404)
    }

    // 2. Generar código OTP (operación rápida)
    const code = await requestOTP(phone)

    // 3. Responder INMEDIATAMENTE al frontend - CRÍTICO para evitar timeout de Vercel
    // El envío por WhatsApp se hace en background sin esperar
    const responsePromise = c.json({ status: 'sent' })

    // 4. Enviar WhatsApp en background (no esperamos respuesta)
    const sendWhatsAppAsync = async () => {
      try {
        if (isPgBossReady()) {
          await getBoss().send('enviar-otp-whatsapp', { phone, code, traceId: trace.id }, {
            retryLimit: 3,
            retryDelay: 5,
            retryBackoff: true,
            expireInSeconds: 300,
          })
          trace.event({ name: 'otp_queued', output: { via: 'pg-boss' } })
        } else {
          await sendOTPViaWhatsApp(phone, code)
          trace.event({ name: 'otp_sent_direct', output: { via: 'direct' } })
          console.log(`[auth] OTP enviado a ${phone.slice(-4)}***`)
        }
      } catch (err: unknown) {
        console.error(`[auth] Error enviando OTP a ${phone.slice(-4)}***:`, err)
        trace.event({ name: 'otp_send_failed', level: 'ERROR', output: { error: String(err) } })
        // No lanzamos error - el usuario puede reintentar desde el UI
      }
    }

    // Ejecutar envío sin await (fire-and-forget)
    sendWhatsAppAsync()

    return responsePromise
  } catch (err: any) {
    console.error('[auth] Error en request-otp:', err)
    trace.event({ name: 'error', level: 'ERROR', output: { error: err.message } })

    // Mensajes de error específicos según el tipo de error
    if (err.message?.includes('Timeout')) {
      return c.json({ error: 'El servicio está tardando demasiado. Intenta de nuevo.' }, 504)
    }
    if (err.message?.includes('Demasiadas solicitudes')) {
      return c.json({ error: err.message }, 429)
    }
    return c.json({ error: err.message || 'Error interno del servidor' }, 500)
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
