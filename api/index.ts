import { requestOTP, verifyOTP } from '../src/auth/otpService.js'
import { sendOTPViaWhatsApp } from '../src/auth/whatsappAuthService.js'
import { getUserByPhone } from '../src/pipeline/supabaseQueries.js'

export const config = { maxDuration: 30 }

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })

const readBody = (req: Request): Promise<unknown> =>
  Promise.race([
    req.json(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Body read timeout (5s)')), 5000)
    ),
  ])

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const origin = req.headers.get('Origin') ?? '*'

  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  console.log(`[handler] ${req.method} ${path}`)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // Health
  if (path === '/health' || path === '/api/health') {
    return json({ status: 'ok', environment: 'vercel' }, 200, cors)
  }

  // Ping
  if ((path === '/api/auth/ping' || path === '/auth/ping') && req.method === 'GET') {
    return json({ status: 'pong', time: new Date().toISOString() }, 200, cors)
  }

  // POST /api/auth/request-otp  or  /auth/request-otp
  if (
    (path === '/api/auth/request-otp' || path === '/auth/request-otp') &&
    req.method === 'POST'
  ) {
    try {
      const body = await readBody(req).catch(() => ({})) as Record<string, string>
      const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')

      if (!phone) return json({ error: 'Número de teléfono requerido' }, 400, cors)

      const usuario = await getUserByPhone(phone)
      if (!usuario) {
        return json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' }, 404, cors)
      }

      const code = await requestOTP(phone)

      // Fire-and-forget
      sendOTPViaWhatsApp(phone, code).catch((err: Error) =>
        console.error('[handler] Error enviando OTP por WhatsApp:', err.message)
      )

      return json({ status: 'sent' }, 200, cors)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno'
      console.error('[handler] Error en request-otp:', msg)
      return json({ error: msg }, 500, cors)
    }
  }

  // POST /api/auth/verify-otp  or  /auth/verify-otp
  if (
    (path === '/api/auth/verify-otp' || path === '/auth/verify-otp') &&
    req.method === 'POST'
  ) {
    try {
      const body = await readBody(req).catch(() => ({})) as Record<string, string>
      const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '')
      const code = body.code

      if (!phone || !code) return json({ error: 'Teléfono y código requeridos' }, 400, cors)

      const result = await verifyOTP(phone, code)
      if (!result.success) return json({ error: result.error }, 401, cors)

      const usuario = await getUserByPhone(phone)
      if (!usuario) return json({ error: 'Usuario no encontrado tras verificación' }, 404, cors)

      return json(
        { user: { id: usuario.id, phone: usuario.phone, rol: usuario.rol, nombre: usuario.nombre } },
        200,
        cors
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno'
      console.error('[handler] Error en verify-otp:', msg)
      return json({ error: msg }, 500, cors)
    }
  }

  console.log(`[handler] 404: ${path}`)
  return json({ error: `Ruta no encontrada: ${path}` }, 404, cors)
}
