import { describe, it, expect, vi, beforeEach } from 'vitest'

// supabaseQueries is imported by provisionarCliente.ts; mock it so supabase.ts
// never executes (it throws if SUPABASE_URL is not set).
vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  getUserByPhone: vi.fn(),
  provisionarClienteAtomico: vi.fn(),
}))

// Mock provisionarCliente so each test controls its return value.
// The async factory preserves named exports (ProvisionInputSchema) from the real module.
vi.mock('../../../src/agents/provisioning/provisionarCliente.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/agents/provisioning/provisionarCliente.js')>()
  return {
    ...original,
    provisionarCliente: vi.fn(),
  }
})

// We do NOT import src/index.ts — we build a minimal Hono app from the schema
// and route factory exported by provisionarCliente.ts to keep the test isolated.
// The route logic lives entirely in src/index.ts so we replicate only the route
// under test here, mirroring the exact handler code we will write in T-11.

import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import {
  provisionarCliente,
  ProvisionInputSchema,
} from '../../../src/agents/provisioning/provisionarCliente.js'

const mockProvisionarCliente = vi.mocked(provisionarCliente)

// ── Helper: replicate the same secureSecretCompare used in src/index.ts ───────

function secureSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(String(a))
  const bBuf = Buffer.from(String(b))
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

// ── Build a minimal app that only has the one route under test ────────────────

function buildApp(reporteSecret = 'test-secret') {
  const app = new Hono()

  app.post('/internal/provision-client', async (c) => {
    const secret = c.req.header('x-reporte-secret')
    const expected = reporteSecret
    if (!secret || !expected || !secureSecretCompare(secret, expected)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = ProvisionInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({ error: 'Validation error', issues: parsed.error.issues }, 400)
    }

    try {
      const result = await provisionarCliente(parsed.data, {})
      const status = result.yaExistia ? 200 : 201
      return c.json(
        { org_id: result.orgId, usuario_id: result.usuarioId, ya_existia: result.yaExistia },
        status,
      )
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500)
    }
  })

  return app
}

// ── Valid body fixture ────────────────────────────────────────────────────────

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    nombre_org: 'Bananera San Marcos',
    pais: 'EC',
    tipo_org: 'empresa',
    telefono_admin: '+593987654321',
    nombre_admin: 'Carlos López',
    cultivo_principal: 'banano',
    consent_texto: 'Acepto los términos de uso de Wasagro.',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('POST /internal/provision-client — auth guard', () => {
  it('returns 401 when x-reporte-secret header is missing', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when x-reporte-secret header has wrong value', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'wrong-secret',
      },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(401)
  })
})

// ─── Non-enumeration security ─────────────────────────────────────────────────

describe('POST /internal/provision-client — non-enumeration', () => {
  it('returns identical 401 body regardless of whether phone/org exists (no DB state leak)', async () => {
    const app = buildApp()

    // Simulate: phone does NOT exist (provisionarCliente would return yaExistia:false)
    mockProvisionarCliente.mockResolvedValueOnce({ orgId: 'ORG001', usuarioId: 'uid-1', yaExistia: false })
    const res1 = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'bad-secret',
      },
      body: JSON.stringify(validBody()),
    })

    // Simulate: phone DOES exist (provisionarCliente would return yaExistia:true)
    mockProvisionarCliente.mockResolvedValueOnce({ orgId: 'ORG002', usuarioId: 'uid-2', yaExistia: true })
    const res2 = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'bad-secret',
      },
      body: JSON.stringify(validBody({ telefono_admin: '+593987000001' })),
    })

    expect(res1.status).toBe(401)
    expect(res2.status).toBe(401)

    const body1 = await res1.json()
    const body2 = await res2.json()
    expect(body1).toEqual(body2)
    // provisionarCliente must NOT have been called (auth check is fail-closed, before dispatch)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })
})

// ─── Zod validation ───────────────────────────────────────────────────────────

describe('POST /internal/provision-client — payload validation', () => {
  it('returns 400 when telefono_admin is missing', async () => {
    const app = buildApp()
    const body = validBody()
    delete (body as Record<string, unknown>)['telefono_admin']
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('returns 400 when consent_texto is missing', async () => {
    const app = buildApp()
    const body = validBody()
    delete (body as Record<string, unknown>)['consent_texto']
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('returns 400 when consent_texto is empty string', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody({ consent_texto: '' })),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('returns 400 when consent_texto exceeds max length', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody({ consent_texto: 'x'.repeat(2001) })),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })
})

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST /internal/provision-client — happy path', () => {
  it('returns 201 with snake_case body when provisionarCliente returns yaExistia=false', async () => {
    const app = buildApp()
    mockProvisionarCliente.mockResolvedValueOnce({
      orgId: 'ORG001',
      usuarioId: 'uuid-admin-1',
      yaExistia: false,
    })

    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ org_id: 'ORG001', usuario_id: 'uuid-admin-1', ya_existia: false })
  })

  it('returns 200 with ya_existia=true when provisionarCliente returns yaExistia=true (idempotent)', async () => {
    const app = buildApp()
    mockProvisionarCliente.mockResolvedValueOnce({
      orgId: 'ORG002',
      usuarioId: 'uuid-admin-2',
      yaExistia: true,
    })

    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody({ telefono_admin: '+593987000002' })),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ org_id: 'ORG002', usuario_id: 'uuid-admin-2', ya_existia: true })
  })

  it('maps cooperativa tipo_org to empresa in the ProvisionInput passed to provisionarCliente', async () => {
    const app = buildApp()
    mockProvisionarCliente.mockResolvedValueOnce({
      orgId: 'ORG003',
      usuarioId: 'uuid-admin-3',
      yaExistia: false,
    })

    await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody({ tipo_org: 'cooperativa' })),
    })

    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
    const callArg = mockProvisionarCliente.mock.calls[0]![0]
    // cooperativa must be mapped to empresa at the schema boundary so the DB enum is never violated
    expect(callArg.tipoOrg).toBe('empresa')
  })
})

// ─── Error path ───────────────────────────────────────────────────────────────

describe('POST /internal/provision-client — error handling', () => {
  it('returns 500 without stack trace when provisionarCliente throws', async () => {
    const app = buildApp()
    mockProvisionarCliente.mockRejectedValueOnce(new Error('DB connection failed'))

    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'test-secret',
      },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    // Must not expose stack trace or internal error detail
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toContain('DB connection failed')
    expect(JSON.stringify(body)).not.toContain('stack')
  })
})
