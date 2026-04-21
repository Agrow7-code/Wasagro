import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { webhookRouter } from './webhook/router.js'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/webhook', webhookRouter)

serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })
