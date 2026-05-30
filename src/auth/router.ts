import { Hono } from 'hono'
import { requestOTP, verifyOTP } from './otpService.js'
import { sendOTPViaWhatsApp } from './whatsappAuthService.js'
import { emitirJWT, verificarJWT, requireJwtSecret } from './jwtService.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'

export const authRouter = new Hono()

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

  // Constant-time response: regardless of whether the user exists or not, the
  // total handler latency is in the same band. This prevents an attacker from
  // enumerating registered phone numbers by measuring response time.
  const startedAt = Date.now();
  const MIN_LATENCY_MS = 1500;
  const MAX_LATENCY_MS = 2500;
  const targetMs = MIN_LATENCY_MS + Math.floor(Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS));

  async function padToTarget(): Promise<void> {
    const elapsed = Date.now() - startedAt;
    const remaining = targetMs - elapsed;
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
  }

  try {
    console.log(`[auth] Solicitando para ${phone}`);

    const usuario = await callWithTimeout(getUserByPhone(phone), 4000)
      .catch(err => { if (err.message === 'TIMEOUT_LIMIT') throw new Error('DB_LENTA'); throw err; });

    if (!usuario) {
      await padToTarget();
      return c.json({ status: 'sent' });
    }

    const code = await callWithTimeout(requestOTP(phone), 4000)
      .catch(err => { if (err.message === 'TIMEOUT_LIMIT') throw new Error('DB_LENTA'); throw err; });

    await callWithTimeout(sendOTPViaWhatsApp(phone, code), 6000).catch(e => {
      console.error('[WhatsApp Error Diferido]:', e.message);
    });

    await padToTarget();
    return c.json({ status: 'sent' });

  } catch (err: any) {
    console.error(`[auth] Error crítico:`, err.message);
    await padToTarget();
    const msg = err.message === 'DB_LENTA'
      ? 'La base de datos no responde a tiempo. Reintenta.'
      : 'Error en el servidor';
    return c.json({ error: msg }, 500);
  }
});

authRouter.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token requerido' }, 401)
  }
  try {
    const payload = await verificarJWT(authHeader.slice(7))
    const usuario = await callWithTimeout(getUserByPhone(payload.phone), 4000)
    if (!usuario) return c.json({ error: 'Usuario no encontrado' }, 404)
    return c.json({ user: { id: usuario.id, phone: usuario.phone, rol: usuario.rol, nombre: usuario.nombre, finca_id: usuario.finca_id ?? null } })
  } catch {
    return c.json({ error: 'Token inválido o expirado' }, 401)
  }
})

authRouter.post('/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = body.phone?.replace(/\+/g, '').replace(/\s/g, '');
  const { code } = body;

  try {
    const result = await callWithTimeout(verifyOTP(phone, code), 4000);
    if (!result.success) return c.json({ error: result.error }, 401);

    const usuario = await getUserByPhone(phone);
    if (!usuario) return c.json({ error: 'Usuario no encontrado' }, 404);

    requireJwtSecret()
    const token = await emitirJWT({
      id: usuario.id,
      phone: usuario.phone,
      rol: usuario.rol,
      finca_id: usuario.finca_id ?? null,
    })

    return c.json({
      token,
      user: { id: usuario.id, phone: usuario.phone, rol: usuario.rol, nombre: usuario.nombre, finca_id: usuario.finca_id ?? null },
    });
  } catch (err) {
    console.error('[auth] verify-otp error:', err)
    return c.json({ error: 'Error de verificación' }, 500);
  }
});
