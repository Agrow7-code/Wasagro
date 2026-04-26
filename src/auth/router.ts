import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'
import { langfuse } from '../integrations/langfuse.js'

export const authRouter = new Hono()

authRouter.post('/request-otp', async (c) => {
  const { phone } = await c.req.json()
  if (!phone) return c.json({ error: 'Número de teléfono requerido' }, 400)

  const trace = langfuse.trace({ name: 'auth_request_otp', input: { phone } })

  try {
    // 1. Verificar que el usuario existe
    const usuario = await getUserByPhone(phone)
    if (!usuario) {
      trace.event({ name: 'user_not_found', level: 'WARNING' })
      return c.json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' }, 404)
    }

    // 2. Generar y guardar OTP
    const code = await requestOTP(phone)

    // 3. Enviar por WhatsApp en background — no bloqueamos la respuesta al usuario.
    // El OTP ya está guardado en DB; si WhatsApp llega tarde (cold start de Evolution)
    // el usuario simplemente espera en la pantalla de código.
    sendOTPViaWhatsApp(phone, code).catch(err =>
      console.error('[auth] WhatsApp send failed:', err?.message ?? err)
    )

    trace.event({ name: 'otp_sent' })
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
