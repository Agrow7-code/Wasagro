import { requestOTP } from '../../src/auth/otpService.js'
import { sendOTPViaWhatsApp } from '../../src/auth/whatsappAuthService.js'
import { getUserByPhone } from '../../src/pipeline/supabaseQueries.js'

// Orígenes permitidos. NUNCA usar '*' junto con Allow-Credentials (combinación
// insegura e ignorada por los navegadores). Mantener en sync con el CORS de
// src/index.ts (origen canónico del backend Hono en Railway).
const ALLOWED_ORIGINS = [
  'https://wasagro.vercel.app',
  'https://wasagro.co',
  'http://localhost:5173',
]
const PREVIEW_ORIGIN_RE = /^https:\/\/wasagro-.*\.vercel\.app$/

function applyCors(req: any, res: any): void {
  const origin = req.headers?.origin as string | undefined
  if (origin && (ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: any, res: any) {
  applyCors(req, res)

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = req.body || {};
  const phone = body.phone?.replace(/\+/g, '')?.replace(/\s/g, '');

  if (!phone) return res.status(400).json({ error: 'Número de teléfono requerido' });

  try {
    const usuario = await getUserByPhone(phone);

    // Respuesta uniforme exista o no el usuario: no se filtra si el número
    // está registrado (anti-enumeración, P5/P6). El rate-limit vive en requestOTP.
    if (usuario) {
      const code = await requestOTP(phone);
      await sendOTPViaWhatsApp(phone, code).catch((e: any) =>
        console.error('[request-otp] envío WhatsApp falló:', e?.message)
      );
    }

    return res.status(200).json({ status: 'sent' });
  } catch (err: any) {
    console.error('[request-otp] Error:', err?.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
