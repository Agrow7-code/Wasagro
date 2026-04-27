import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'

export const authRouter = new Hono()

authRouter.get('/ping', (c) => c.json({ status: 'pong' }))

authRouter.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
  
  if (!phone) return c.json({ error: 'Número de teléfono requerido' }, 400)

  try {
    const usuario = await getUserByPhone(phone)
    if (!usuario) return c.json({ error: 'Número no registrado' }, 404)

    const code = await requestOTP(phone)

    // Envío de WhatsApp en background
    // No usamos await para que la respuesta HTTP salga de inmediato
    const sendWhatsApp = async () => {
      try {
        await sendOTPViaWhatsApp(phone, code)
      } catch (e) {
        console.error('[WhatsApp Background Error]:', e)
      }
    }

    // Le decimos a Hono/Vercel que no mate el proceso hasta que esto termine
    if (c.executionCtx) {
      c.executionCtx.waitUntil(sendWhatsApp())
    } else {
      sendWhatsApp()
    }

    return c.json({ status: 'sent' })

  } catch (err: any) {
    console.error(`[auth] Error:`, err.message)
    return c.json({ error: 'Error al procesar solicitud' }, 500)
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
