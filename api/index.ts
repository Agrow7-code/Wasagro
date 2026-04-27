import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

// Logger para Vercel
app.use('*', async (c, next) => {
  console.log(`[Vercel API] ${c.req.method} ${c.req.url}`)
  await next()
})

const previewOriginRe = /^https:\/\/wasagro-.*\.vercel\.app$/

app.use('*', cors({
  origin: (origin) => origin, // Permitir todo temporalmente para debug
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Montar el router de auth directamente
app.route('/auth', authRouter)

app.get('/health', (c) => c.json({
  status: 'ok',
  time: new Date().toISOString()
}))

export const config = {
  maxDuration: 60,
}

export default async function handler(req: Request) {
  return app.fetch(req)
}
