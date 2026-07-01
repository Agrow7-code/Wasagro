import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  setHandoffEstado: vi.fn().mockResolvedValue(undefined),
  getConversacionThread: vi.fn(),
}))

import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { roleGuard } from '../../../src/auth/roleGuard.js'
import { getConversacionThread } from '../../../src/pipeline/supabaseQueries.js'

const mockGetConversacionThread = vi.mocked(getConversacionThread)

function buildApp(authedUser: unknown = { rol: 'director' }) {
  const app = new Hono()
  app.use('/api/admin/*', async (c: Context, next: Next) => {
    c.set('authedUser', authedUser)
    await next()
  })
  app.use('/api/admin/*', roleGuard)
  app.route('/api/admin', adminRouter)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/conversaciones/:id/mensajes', () => {
  it('known id with 6 interactions: 200, chronological order, embedded phone masked', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      phone: '593987654321',
      contenido: `turno ${i}`,
      origen: i % 2 === 0 ? 'mensajes_entrada' : 'sdr_interacciones',
      created_at: `2026-07-01T10:0${i}:00Z`,
    }))
    mockGetConversacionThread.mockResolvedValueOnce(rows)

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/mensajes')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(6)
    expect(body.map((r) => r['id'])).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
    for (const row of body) expect(row['phone']).toMatch(/^\*{4}\d{4}$/)
    expect(JSON.stringify(body)).not.toContain('593987654321')
    expect(mockGetConversacionThread).toHaveBeenCalledWith('p1')
  })

  it('unknown id returns 200 with [] — never 404/500 (non-enumeration)', async () => {
    mockGetConversacionThread.mockResolvedValueOnce([])

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/unknown-id/mensajes')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('non-director is rejected with 403 and the query is never run', async () => {
    const app = buildApp({ rol: 'gerente' })
    const res = await app.request('/api/admin/conversaciones/p1/mensajes')

    expect(res.status).toBe(403)
    expect(mockGetConversacionThread).not.toHaveBeenCalled()
  })
})
