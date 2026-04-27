import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'
import { isPgBossReady, getBoss } from '../workers/pgBoss.js'

export const authRouter = new Hono()

authRouter.post('/request-otp', async (c) => {
  console.log('[auth] --- NUEVA SOLICITUD OTP ---')
  const body = await c.req.json().catch(() => ({}))
  console.log('[auth] Body recibido:', JSON.stringify(body))
  
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
  if (!phone) {
    console.log('[auth] Error: Falta teléfono')
    return c.json({ error: 'Número de teléfono requerido' }, 400)
  }

  console.log(`[auth] Buscando usuario: ${phone}`)
  try {
    const startDb = Date.now()
    const usuario = await getUserByPhone(phone)
    console.log(`[auth] DB lookup usuario: ${usuario ? 'Encontrado' : 'No encontrado'} (${Date.now() - startDb}ms)`)

    if (!usuario) {
      return c.json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' }, 404)
    }

    console.log('[auth] Generando código OTP...')
    const code = await requestOTP(phone)
    console.log(`[auth] OTP generado con éxito: ${code.slice(0, 2)}****`)

    // Background send
    const enviarWhatsApp = async () => {
      try {
        console.log('[auth] Iniciando envío WhatsApp background...')
        if (isPgBossReady()) {
          await getBoss().send('enviar-otp-whatsapp', { phone, code, traceId: 'no-trace' })
        } else {
          await sendOTPViaWhatsApp(phone, code)
        }
        console.log('[auth] Envío WhatsApp background completado')
      } catch (err: any) {
        console.error('[auth] Error en envío background:', err.message)
      }
    }

    enviarWhatsApp()
    console.log('[auth] Respondiendo al cliente...')
    return c.json({ status: 'sent' })
  } catch (err: any) {
    console.error(`[auth] Error crítico en request-otp:`, err)
    return c.json({ error: err.message || 'Error interno del servidor' }, 500)
  }
})

authRouter.post('/verify-otp', async (c) => {
  console.log('[auth] --- VERIFICACIÓN OTP ---')
  const body = await c.req.json().catch(() => ({}))
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
  const { code } = body

  if (!phone || !code) {
    console.log('[auth] Error: Falta teléfono o código')
    return c.json({ error: 'Teléfono y código requeridos' }, 400)
  }

  console.log(`[auth] Verificando código para ${phone}: ${code}`)
  try {
    const result = await verifyOTP(phone, code)
    if (!result.success) {
      console.log('[auth] Verificación fallida:', result.error)
      return c.json({ error: result.error }, 401)
    }

    const usuario = await getUserByPhone(phone)
    if (!usuario) {
      console.log('[auth] Usuario no encontrado tras verificación')
      return c.json({ error: 'Usuario no encontrado tras verificación' }, 404)
    }

    console.log('[auth] Verificación exitosa para:', usuario.rol)
    return c.json({ 
      user: {
        id: usuario.id,
        phone: usuario.phone,
        rol: usuario.rol,
        nombre: usuario.nombre
      }
    })
  } catch (err: any) {
    console.error(`[auth] Error en verify-otp:`, err)
    return c.json({ error: err.message || 'Error interno del servidor' }, 500)
  }
})
