import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Montamos las rutas con ambos prefijos
app.route('/api/auth', authRouter)
app.route('/auth', authRouter)

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default async function handler(req: Request, event: any) {
  // Pasamos el evento de Vercel a Hono para que funcione c.executionCtx.waitUntil
  return app.fetch(req, {}, event)
}
