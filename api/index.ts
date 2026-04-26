import { Hono } from 'hono'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/auth', authRouter)

export default app
