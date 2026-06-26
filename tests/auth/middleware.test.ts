import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { finca_id: 'F001', org_id: 'ORG-A' }, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
  createUserScopedClient: vi.fn(),
}))

vi.mock('../../src/auth/jwtService.js', () => ({
  verificarJWT: vi.fn().mockResolvedValue({
    sub: 'user-001',
    phone: '593987654321',
    rol: 'agricultor',
    finca_id: 'F001',
    org_id: 'ORG-A',
  }),
  firmarJWT: vi.fn().mockReturnValue('mock-jwt-token'),
}))

import { Hono } from 'hono'
import { authMiddleware, requireFincaAccessAsync, requireOrgAccessAsync, getUserSupabase } from '../../src/auth/middleware.js'
import { createUserScopedClient } from '../../src/integrations/supabase.js'

function crearApp() {
  const app = new Hono()
  app.use('/api/*', authMiddleware)
  app.get('/api/test-me', (c) => {
    const user = c.get('authedUser')
    const db = getUserSupabase(c)
    return c.json({ user, hasScopedClient: db !== null })
  })
  app.get('/api/test-finca/:finca_id', async (c) => {
    const finca_id = c.req.param('finca_id')
    if (!await requireFincaAccessAsync(c, finca_id)) {
      return c.json({ error: 'Sin acceso' }, 403)
    }
    return c.json({ ok: true, finca_id })
  })
  app.get('/api/test-org/:org_id', async (c) => {
    const org_id = c.req.param('org_id')
    const access = await requireOrgAccessAsync(c, org_id)
    if (access === 'unauthorized') return c.json({ error: 'Token requerido' }, 401)
    if (access === 'forbidden') return c.json({ error: 'Sin acceso a org' }, 403)
    return c.json({ ok: true, org_id })
  })
  return app
}

describe('Auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects requests without Authorization header', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-me', {})
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Token requerido')
  })

  it('rejects requests with malformed Authorization header', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-me', {
      headers: { Authorization: 'Basic abc123' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts valid JWT and sets authedUser', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-me', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.id).toBe('user-001')
    expect(body.user.phone).toBe('593987654321')
    expect(body.user.rol).toBe('agricultor')
  })

  it('creates user-scoped Supabase client when SUPABASE_ANON_KEY is available', async () => {
    const mockScopedClient = { from: vi.fn() }
    vi.mocked(createUserScopedClient).mockReturnValue(mockScopedClient as any)

    const app = crearApp()
    const res = await app.request('/api/test-me', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasScopedClient).toBe(true)
    expect(createUserScopedClient).toHaveBeenCalledWith('valid-jwt')
  })

  it('gracefully falls back when createUserScopedClient throws (no SUPABASE_ANON_KEY)', async () => {
    vi.mocked(createUserScopedClient).mockImplementation(() => {
      throw new Error('SUPABASE_ANON_KEY requerido')
    })

    const app = crearApp()
    const res = await app.request('/api/test-me', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasScopedClient).toBe(false)
  })
})

describe('requireFincaAccessAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows access to own finca for agricultor', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-finca/F001', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
  })

  it('denies access to other finca for agricultor', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-finca/F999', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(403)
  })

  it('allows admin_org access to a finca within its own organization', async () => {
    // El mock de supabase.single devuelve org_id 'ORG-A' para la finca consultada.
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'admin-001',
      phone: '593987654321',
      rol: 'admin_org',
      finca_id: 'F001',
      org_id: 'ORG-A',
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-finca/F999', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
  })

  it('denies admin_org access to a finca in a DIFFERENT organization (cross-tenant)', async () => {
    // Admin de ORG-B intentando acceder a F999, que pertenece a ORG-A.
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'admin-002',
      phone: '593900000000',
      rol: 'admin_org',
      finca_id: 'F500',
      org_id: 'ORG-B',
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-finca/F999', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(403)
  })

  it('allows access to any finca for director (back-office global)', async () => {
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'dir-001',
      phone: '593987654321',
      rol: 'director',
      finca_id: 'F001',
      org_id: null,
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-finca/F999', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
  })
})

// ─── T1.15 — requireOrgAccessAsync tests ─────────────────────────────────────

describe('requireOrgAccessAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows director access to any org (global back-office)', async () => {
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'dir-001',
      phone: '593987654321',
      rol: 'director',
      finca_id: null,
      org_id: null,
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-org/ORG-B', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
  })

  it('allows admin_org access to its own org', async () => {
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'admin-001',
      phone: '593987654321',
      rol: 'admin_org',
      finca_id: 'F001',
      org_id: 'ORG-A',
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-org/ORG-A', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
  })

  it('denies admin_org access to a different org (cross-tenant D31)', async () => {
    const { verificarJWT } = await import('../../src/auth/jwtService.js')
    vi.mocked(verificarJWT).mockResolvedValueOnce({
      sub: 'admin-002',
      phone: '593900000000',
      rol: 'admin_org',
      finca_id: 'F500',
      org_id: 'ORG-B',
    } as any)

    const app = crearApp()
    const res = await app.request('/api/test-org/ORG-A', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 401 when not authenticated', async () => {
    const app = crearApp()
    const res = await app.request('/api/test-org/ORG-A')
    expect(res.status).toBe(401)
  })
})
