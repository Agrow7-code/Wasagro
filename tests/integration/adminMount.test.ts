import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `src/index.ts` is NOT imported directly by this suite (or by any other test in
// this repo): it runs heavy, unconditional side effects at module load
// (validarEnvVars() can process.exit(1), plus WhatsApp/LLM adapter creation,
// pg-boss init, and cron.schedule registration before the Hono app is even
// built). Instead this suite:
//   1. Reconstructs the EXACT mount chain from the T-S2.6 insertion point
//      (authMiddleware → roleGuard → rateLimiter → adminRouter, no planGuard)
//      using the real middleware/router modules, to prove the behavioral
//      contract: an expired-trial director is NOT blocked on /api/admin/*,
//      with a planGuard-wrapped control route proving the same mocked state
//      WOULD block on a route that has planGuard.
//   2. Asserts the literal placement + absence of planGuard in src/index.ts's
//      source text, which is what the T-S2.6 edit actually changes.

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock('../../src/auth/jwtService.js', () => ({
  verificarJWT: vi.fn(),
  firmarJWT: vi.fn(),
}))

import { Hono } from 'hono'
import { authMiddleware } from '../../src/auth/middleware.js'
import { roleGuard } from '../../src/auth/roleGuard.js'
import { planGuard } from '../../src/auth/planGuard.js'
import { rateLimiter } from '../../src/auth/rateLimiter.js'
import { adminRouter } from '../../src/agents/admin/router.js'
import { supabase } from '../../src/integrations/supabase.js'
import { verificarJWT } from '../../src/auth/jwtService.js'

function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function buildApp() {
  const app = new Hono()

  // Replica of the index.ts admin mount block (T-S2.6) — NO planGuard.
  app.use('/api/admin/*', authMiddleware)
  app.use('/api/admin/*', roleGuard)
  app.use('/api/admin/*', rateLimiter({ windowMs: 60_000, maxRequests: 60 }))
  app.route('/api/admin', adminRouter)

  // Control route: mounted the SAME way /api/metricas/* is in index.ts (WITH
  // planGuard), to prove the mocked expired-trial state DOES block when
  // planGuard is present — confirming the admin route's 200 above is because
  // planGuard is absent, not because the mock happens to always allow.
  app.use('/api/metricas-like/*', authMiddleware)
  app.use('/api/metricas-like/*', planGuard)
  app.get('/api/metricas-like/probe', (c) => c.json({ ok: true }))

  return app
}

describe('Admin mount — director with expired trial is not blocked by planGuard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /api/admin/orgs returns 200 for a director whose own org trial has expired', async () => {
    vi.mocked(verificarJWT).mockResolvedValue({
      sub: 'dir-1', phone: '593900000000', rol: 'director', finca_id: null, org_id: 'ORG-EXPIRED',
    } as never)

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ count: 1, reset_at: new Date(Date.now() + 60_000).toISOString(), allowed: true }],
      error: null,
    } as never)

    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'organizaciones') {
        return queryBuilder({
          data: [{
            org_id: 'ORG-EXPIRED', nombre: 'Org Expirada', plan: 'trial',
            subscription_status: 'none', trial_inicio: '2020-01-01', trial_fin: '2020-02-01',
            fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
            fincas: { count: 0 }, usuarios: { count: 0 },
          }],
          error: null,
        })
      }
      return queryBuilder({ data: [], error: null })
    }) as typeof supabase.from)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs', { headers: { Authorization: 'Bearer valid-jwt' } })

    expect(res.status).toBe(200)
  })

  it('control: the SAME expired-trial director IS blocked (402) on a planGuard-wrapped route', async () => {
    vi.mocked(verificarJWT).mockResolvedValue({
      sub: 'dir-1', phone: '593900000000', rol: 'director', finca_id: null, org_id: 'ORG-EXPIRED',
    } as never)

    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'usuarios') {
        return queryBuilder({ data: { org_id: 'ORG-EXPIRED' }, error: null })
      }
      if (table === 'organizaciones') {
        return queryBuilder({
          data: {
            plan: 'trial', trial_fin: '2020-02-01', subscription_status: 'none',
            is_test_org: false, fincas_contratadas: 1, usuarios_contratados: 1,
            precio_mensual: null, created_at: '2020-01-01',
          },
          error: null,
        })
      }
      return queryBuilder({ data: null, error: null })
    }) as typeof supabase.from)

    const app = buildApp()
    const res = await app.request('/api/metricas-like/probe', { headers: { Authorization: 'Bearer valid-jwt' } })

    expect(res.status).toBe(402)
  })
})

describe('src/index.ts — admin mount placement (structural guard, T-S2.6)', () => {
  it('mounts adminRouter between /api/auth and the /api/metricas authMiddleware, with NO planGuard on /api/admin/*', () => {
    const source = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf-8')

    const authRouteIdx = source.indexOf("app.route('/api/auth', authRouter)")
    const adminMountIdx = source.indexOf("app.use('/api/admin/*'")
    const adminRouteIdx = source.indexOf("app.route('/api/admin', adminRouter)")
    const metricasAuthIdx = source.indexOf("app.use('/api/metricas/*', authMiddleware)")
    const catchAllIdx = source.indexOf("app.use('/api/*', rateLimiter(")

    expect(authRouteIdx).toBeGreaterThan(-1)
    expect(adminMountIdx).toBeGreaterThan(-1)
    expect(adminRouteIdx).toBeGreaterThan(-1)
    expect(metricasAuthIdx).toBeGreaterThan(-1)
    expect(catchAllIdx).toBeGreaterThan(-1)

    // Insertion point: between /api/auth route and /api/metricas authMiddleware.
    expect(adminMountIdx).toBeGreaterThan(authRouteIdx)
    expect(adminRouteIdx).toBeLessThan(metricasAuthIdx)

    // Admin mount is declared before the /api/* catch-all rate limiter (own limiter).
    expect(adminRouteIdx).toBeLessThan(catchAllIdx)

    // The admin block itself must never reference planGuard.
    const adminBlock = source.slice(adminMountIdx, adminRouteIdx + "app.route('/api/admin', adminRouter)".length)
    expect(adminBlock).not.toContain('planGuard')
    expect(adminBlock).toContain("app.use('/api/admin/*', roleGuard)")
  })
})
