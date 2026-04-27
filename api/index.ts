import { Hono } from 'hono'
import { authRouter } from '../src/auth/router.js'

const app = new Hono()

// Montamos las rutas con ambos prefijos para que Vercel no se pierda
app.route('/api/auth', authRouter)
app.route('/auth', authRouter)

// Fallback de seguridad
app.notFound((c) => c.json({ error: 'Ruta no encontrada en el backend' }, 404))

export default async function handler(req: Request) {
  return app.fetch(req)
}
