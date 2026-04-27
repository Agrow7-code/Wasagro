import { requestOTP } from '../../src/auth/otpService.js'
import { sendOTPViaWhatsApp } from '../../src/auth/whatsappAuthService.js'
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

  if (!phone) return res.status(400).json({ error: 'Número de teléfono requerido' });

  try {
    console.log(`[Vercel Native] Buscando a ${phone}`);
    const usuario = await getUserByPhone(phone);
    if (!usuario) return res.status(404).json({ error: 'Número no registrado en Wasagro. Contacta a tu administrador.' });

    console.log(`[Vercel Native] Generando OTP`);
    const code = await requestOTP(phone);

    console.log(`[Vercel Native] Enviando WhatsApp a ${phone}`);
    // Esperamos para que el proceso termine después del envío y cierre el socket de forma segura.
    await sendOTPViaWhatsApp(phone, code);

    console.log(`[Vercel Native] Respondiendo 200 OK`);
    return res.status(200).json({ status: 'sent' });
  } catch (err: any) {
    console.error(`[Vercel Native] Error:`, err.message);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
