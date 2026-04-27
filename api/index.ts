import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { authRouter } from '../src/auth/router.js'

const app = new Hono().basePath('/api')

// Montamos las rutas
app.route('/auth', authRouter)

// Fallback de 404 para que no devuelva HTML
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

export default handle(app)
