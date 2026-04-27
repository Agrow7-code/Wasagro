import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

// Middleware de Logs para Vercel (Verás esto en tu dashboard de Vercel -> Logs)
app.use('*', async (c, next) => {
  console.log(`[VERCEL_DEBUG] Petición recibida: ${c.req.method} ${c.req.url}`)
  await next()
  console.log(`[VERCEL_DEBUG] Respuesta enviada: ${c.res.status}`)
})

app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// EL FIX: Montamos el router en ambos paths para que no haya pérdida
app.route('/api/auth', authRouter)
app.route('/auth', authRouter)

// Handler de Errores Global: Evita que Vercel mande HTML en caso de crash
app.onError((err, c) => {
  console.error(`[CRASH_BACKEND]: ${err.message}`)
  return c.json({ 
    error: 'Error interno del servidor', 
    details: err.message,
    path: c.req.path 
  }, 500)
})

// Handler de 404: Si Hono no encuentra la ruta, que responda JSON, no HTML
app.notFound((c) => {
  console.log(`[404_NOT_FOUND]: ${c.req.path}`)
  return c.json({ error: `Ruta no encontrada: ${c.req.path}` }, 404)
})

app.get('/api/health', (c) => c.json({ status: 'ok', environment: 'vercel' }))
app.get('/health', (c) => c.json({ status: 'ok', environment: 'vercel' }))

export const config = {
  maxDuration: 30,
}

export default async function handler(req: Request) {
  return app.fetch(req)
}
