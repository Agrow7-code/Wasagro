import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { handle } from 'hono/vercel'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

// Middleware de Logs para Vercel
app.use('*', async (c, next) => {
  console.log(`[VERCEL_DEBUG] ${c.req.method} ${c.req.url}`)
  await next()
  console.log(`[VERCEL_DEBUG] Status: ${c.res.status}`)
})

app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Rutas
app.route('/api/auth', authRouter)
app.route('/auth', authRouter)

app.get('/api/health', (c) => c.json({ status: 'ok', environment: 'vercel' }))
app.get('/health', (c) => c.json({ status: 'ok', environment: 'vercel' }))

// EL FIX MAESTRO: Usamos el adaptador oficial de Hono para Vercel Node.js
export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

export default handle(app)
