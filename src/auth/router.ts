import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'

export const authRouter = new Hono()

// Helper de timeout para que nada tarde más de 4 segundos
const callWithTimeout = async (promise: Promise<any>, timeoutMs: number) => {
  let timer: any;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT_LIMIT')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

authRouter.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '');
  
  if (!phone) return c.json({ error: 'Falta teléfono' }, 400);

  try {
    console.log(`[auth] Solicitando para ${phone}`);

    // 1. Buscar usuario con timeout de 4s
    const usuario = await callWithTimeout(getUserByPhone(phone), 4000)
      .catch(err => { if (err.message === 'TIMEOUT_LIMIT') throw new Error('DB_LENTA'); throw err; });

    if (!usuario) return c.json({ error: 'Número no registrado' }, 404);

    // 2. Generar OTP con timeout de 4s
    const code = await callWithTimeout(requestOTP(phone), 4000)
      .catch(err => { if (err.message === 'TIMEOUT_LIMIT') throw new Error('DB_LENTA'); throw err; });

    // 3. Envío de WhatsApp (Esperado para que Vercel no mate el proceso, pero con timeout de 6s)
    // Esto asegura que el mensaje se intente enviar y que Vercel luego cierre la conexión HTTP sin 504.
    await callWithTimeout(sendOTPViaWhatsApp(phone, code), 6000).catch(e => {
      console.error('[WhatsApp Error Diferido]:', e.message);
      // No fallamos la request si WhatsApp falla o se demora más de 6s. El OTP ya está en la DB.
    });

    // 4. Responder inmediatamente al frontend
    return c.json({ status: 'sent' });

  } catch (err: any) {
    console.error(`[auth] Error crítico:`, err.message);
    const msg = err.message === 'DB_LENTA' 
      ? 'La base de datos no responde a tiempo. Reintenta.' 
      : 'Error en el servidor';
    return c.json({ error: msg }, 500);
  }
});

authRouter.post('/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '');
  const { code } = body;

  try {
    const result = await callWithTimeout(verifyOTP(phone, code), 4000);
    if (!result.success) return c.json({ error: result.error }, 401);

    const usuario = await getUserByPhone(phone);
    return c.json({ user: { id: usuario?.id, phone: usuario?.phone, rol: usuario?.rol, nombre: usuario?.nombre } });
  } catch (err) {
    return c.json({ error: 'Error de verificación' }, 500);
  }
});
