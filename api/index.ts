import { handle } from 'hono/vercel'
import { Hono } from 'hono'
import { authRouter } from '../src/auth/router.js'

const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRouter)

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

export default handle(app)
