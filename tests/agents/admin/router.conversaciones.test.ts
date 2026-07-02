import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase.js directly (same pattern as router.conversaciones.pause.test.ts)
// so the real module — which throws at import time without
// SUPABASE_URL/SERVICE_ROLE_KEY — is never executed.
vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  setHandoffEstado: vi.fn().mockResolvedValue(undefined),
  getConversacionesList: vi.fn(),
}))

import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { roleGuard } from '../../../src/auth/roleGuard.js'
import { getConversacionesList } from '../../../src/pipeline/supabaseQueries.js'

const mockGetConversacionesList = vi.mocked(getConversacionesList)

// Mirrors the production mount order in src/index.ts.
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

describe('GET /api/admin/conversaciones', () => {
  it('flags needs_attention on paused rows, masks every phone, raw phone never appears', async () => {
    mockGetConversacionesList.mockResolvedValueOnce([
      { id: 'p1', phone: '593987654321', nombre: 'Carlos', empresa: null, status: 'en_discovery', handoff_status: 'human_paused', handoff_reason: 'manual', founder_notified_at: null, ultima_interaccion: '2026-07-01T10:00:00Z' },
      { id: 'p2', phone: '593900000002', nombre: null, empresa: 'Bananera', status: 'qualified', handoff_status: 'human_paused', handoff_reason: 'auto_human_request', founder_notified_at: null, ultima_interaccion: '2026-07-01T09:00:00Z' },
      { id: 'p3', phone: '593900000003', nombre: 'A', empresa: null, status: 'en_discovery', handoff_status: 'bot', handoff_reason: null, founder_notified_at: null, ultima_interaccion: '2026-07-01T08:00:00Z' },
      { id: 'p4', phone: '593900000004', nombre: 'B', empresa: null, status: 'en_discovery', handoff_status: 'bot', handoff_reason: null, founder_notified_at: null, ultima_interaccion: '2026-07-01T07:00:00Z' },
      { id: 'p5', phone: '593900000005', nombre: 'C', empresa: null, status: 'en_discovery', handoff_status: 'bot', handoff_reason: null, founder_notified_at: null, ultima_interaccion: '2026-07-01T06:00:00Z' },
    ])

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(5)

    const paused = body.filter((row) => row['needs_attention'] === true)
    expect(paused.map((row) => row['id'])).toEqual(['p1', 'p2'])
    const notPaused = body.filter((row) => row['id'] === 'p3' || row['id'] === 'p4' || row['id'] === 'p5')
    for (const row of notPaused) expect(row['needs_attention']).toBe(false)

    for (const row of body) expect(row['phone']).toMatch(/^\*{4}\d{4}$/)
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('593987654321')
    expect(raw).not.toContain('593900000002')
  })

  it('needs_attention is false when founder_notified_at is set but handoff_status is bot (not sticky)', async () => {
    mockGetConversacionesList.mockResolvedValueOnce([
      { id: 'p6', phone: '593900000006', nombre: 'D', empresa: null, status: 'qualified', handoff_status: 'bot', handoff_reason: null, founder_notified_at: '2026-07-01T05:00:00Z', ultima_interaccion: '2026-07-01T05:00:00Z' },
    ])

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones')
    const body = (await res.json()) as Array<Record<string, unknown>>

    expect(body[0]!['needs_attention']).toBe(false)
  })

  it('needs_attention is true when handoff_status is human_paused regardless of founder_notified_at', async () => {
    mockGetConversacionesList.mockResolvedValueOnce([
      { id: 'p7', phone: '593900000007', nombre: 'E', empresa: null, status: 'qualified', handoff_status: 'human_paused', handoff_reason: 'manual', founder_notified_at: null, ultima_interaccion: '2026-07-01T05:00:00Z' },
    ])

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones')
    const body = (await res.json()) as Array<Record<string, unknown>>

    expect(body[0]!['needs_attention']).toBe(true)
  })

  it('non-director is rejected with 403 and the query is never run', async () => {
    const app = buildApp({ rol: 'gerente' })
    const res = await app.request('/api/admin/conversaciones')

    expect(res.status).toBe(403)
    expect(mockGetConversacionesList).not.toHaveBeenCalled()
  })
})
