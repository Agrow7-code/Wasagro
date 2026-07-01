import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase.js directly (same pattern as router.orgs.test.ts) so the real
// module — which throws at import time without SUPABASE_URL/SERVICE_ROLE_KEY —
// is never executed.
vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  setHandoffEstado: vi.fn().mockResolvedValue(undefined),
}))

// Regression guard (T-H1.6): the manual pause/resume routes must never ping the
// founder — the founder triggered the transition themselves.
vi.mock('../../../src/integrations/whatsapp/founderAlerts.js', () => ({
  alertarFounder: vi.fn().mockResolvedValue({ sent: true }),
}))

import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { roleGuard } from '../../../src/auth/roleGuard.js'
import { supabase } from '../../../src/integrations/supabase.js'
import { setHandoffEstado } from '../../../src/pipeline/supabaseQueries.js'
import { alertarFounder } from '../../../src/integrations/whatsapp/founderAlerts.js'

const mockSetHandoffEstado = vi.mocked(setHandoffEstado)
const mockAlertarFounder = vi.mocked(alertarFounder)

// Same chainable/awaitable stub shape as router.orgs.test.ts / router.sdr.test.ts.
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

// Mirrors the production mount order in src/index.ts: authMiddleware sets
// `authedUser`, then roleGuard (director-only), then adminRouter.
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

describe('POST /api/admin/conversaciones/:id/pause', () => {
  it('director pause: sets human_paused/manual, returns 200, never pings the founder', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      queryBuilder({ data: { id: 'p1' }, error: null }) as ReturnType<typeof supabase.from>,
    )

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/pause', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mockSetHandoffEstado).toHaveBeenCalledOnce()
    const [id, updates] = mockSetHandoffEstado.mock.calls[0]!
    expect(id).toBe('p1')
    expect(updates).toMatchObject({ handoff_status: 'human_paused', handoff_reason: 'manual' })
    expect(typeof (updates as Record<string, unknown>)['handoff_paused_at']).toBe('string')
    expect(mockAlertarFounder).not.toHaveBeenCalled()
  })

  it('unknown :id returns 404 and does NOT call setHandoffEstado', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      queryBuilder({ data: null, error: null }) as ReturnType<typeof supabase.from>,
    )

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/unknown-id/pause', { method: 'POST' })

    expect(res.status).toBe(404)
    expect(mockSetHandoffEstado).not.toHaveBeenCalled()
  })

  it('non-director returns 403 and does NOT call setHandoffEstado', async () => {
    const app = buildApp({ rol: 'gerente' })
    const res = await app.request('/api/admin/conversaciones/p1/pause', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(mockSetHandoffEstado).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/conversaciones/:id/resume', () => {
  it('director resume: sets bot/clears reason+ping, returns 200', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      queryBuilder({ data: { id: 'p1' }, error: null }) as ReturnType<typeof supabase.from>,
    )

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/resume', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mockSetHandoffEstado).toHaveBeenCalledOnce()
    const [id, updates] = mockSetHandoffEstado.mock.calls[0]!
    expect(id).toBe('p1')
    expect(updates).toMatchObject({
      handoff_status: 'bot',
      handoff_reason: null,
      handoff_last_pinged_at: null,
    })
    expect(typeof (updates as Record<string, unknown>)['handoff_resumed_at']).toBe('string')
  })

  it('unknown :id returns 404 and does NOT call setHandoffEstado', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(
      queryBuilder({ data: null, error: null }) as ReturnType<typeof supabase.from>,
    )

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/unknown-id/resume', { method: 'POST' })

    expect(res.status).toBe(404)
    expect(mockSetHandoffEstado).not.toHaveBeenCalled()
  })

  it('non-director returns 403 and does NOT call setHandoffEstado', async () => {
    const app = buildApp({ rol: 'gerente' })
    const res = await app.request('/api/admin/conversaciones/p1/resume', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(mockSetHandoffEstado).not.toHaveBeenCalled()
  })
})
