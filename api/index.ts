import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from '../src/auth/router.js'

const app = new Hono().basePath('/api')

const previewOriginRe = /^https:\/\/wasagro-.*\.vercel\.app$/

app.use('/auth/*', cors({
  origin: (origin, _c) => {
    if (origin === 'https://wasagro.vercel.app' || origin === 'http://localhost:5173' || previewOriginRe.test(origin)) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.route('/auth', authRouter)

app.get('/health', (c) => c.json({
  status: 'ok',
  provider: process.env['WHATSAPP_PROVIDER'],
  llm: process.env['WASAGRO_LLM'],
}))

export const config = {
  maxDuration: 60,
}

export default async function handler(req: Request) {
  return app.fetch(req)
}
