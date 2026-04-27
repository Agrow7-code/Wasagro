import { verifyOTP } from '../../src/auth/otpService.js'
import { getUserByPhone } from '../../src/pipeline/supabaseQueries.js'

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
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
