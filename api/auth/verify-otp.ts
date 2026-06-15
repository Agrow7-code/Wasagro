import { verifyOTP } from '../../src/auth/otpService.js'
import { getUserByPhone } from '../../src/pipeline/supabaseQueries.js'

// Orígenes permitidos. NUNCA usar '*' junto con Allow-Credentials.
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
  const { code } = body;

  if (!phone || !code) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const result = await verifyOTP(phone, code);
    if (!result.success) return res.status(401).json({ error: result.error });

    const usuario = await getUserByPhone(phone);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    return res.status(200).json({
      user: {
        id: usuario.id,
        phone: usuario.phone,
        rol: usuario.rol,
        nombre: usuario.nombre
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Error al verificar' });
  }
}
