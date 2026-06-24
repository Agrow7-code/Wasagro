import { describe, it, expect, vi, beforeEach } from 'vitest'

// supabaseQueries is imported transitively by provisionarCliente.ts; mock it so
// supabase.ts never executes (it throws when SUPABASE_URL is missing in test env).
vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  getUserByPhone: vi.fn(),
  provisionarClienteAtomico: vi.fn(),
}))

// Mock provisionarCliente so each test controls its return value.
// The async factory spreads real named exports (ProvisionInputSchema, createProvisionHandler)
// while replacing only the domain function.
vi.mock('../../../src/agents/provisioning/provisionarCliente.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/agents/provisioning/provisionarCliente.js')>()
  return {
    ...original,
    provisionarCliente: vi.fn(),
  }
})

import { Hono } from 'hono'
import {
  provisionarCliente,
  createProvisionHandler,
} from '../../../src/agents/provisioning/provisionarCliente.js'

const mockProvisionarCliente = vi.mocked(provisionarCliente)

// ── Shared secret used across all tests ──────────────────────────────────────

const TEST_SECRET = 'test-secret'

// ── Build a Hono app using the REAL handler factory ───────────────────────────
// This guarantees the test exercises the same code path that index.ts uses.

function buildApp(overrides: { secret?: string } = {}) {
  const app = new Hono()
  const handler = createProvisionHandler({
    secret: overrides.secret ?? TEST_SECRET,
  })
  app.post('/internal/provision-client', handler)
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

// ── resetAllMocks in beforeEach ───────────────────────────────────────────────
// vi.resetAllMocks clears .mock.calls AND the pending mockResolvedValueOnce
// queue, preventing stale values from leaking between tests.

beforeEach(() => {
  vi.resetAllMocks()
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

    const res1 = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': 'bad-secret',
      },
      body: JSON.stringify(validBody()),
    })

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
    // Auth runs before dispatch — provisionarCliente must never be called on 401
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
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('returns 400 when telefono_admin is whitespace-only (prevents double-provision via idempotency bypass)', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody({ telefono_admin: '   ' })),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('returns 400 when telefono_admin is too short (fewer than 7 digits)', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody({ telefono_admin: '12345' })),
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
        'x-reporte-secret': TEST_SECRET,
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
        'x-reporte-secret': TEST_SECRET,
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
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody({ consent_texto: 'x'.repeat(2001) })),
    })
    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('400 response does not expose Zod issue paths (non-enumeration)', async () => {
    const app = buildApp()
    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody({ consent_texto: '' })),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    // Must return exactly this shape — no field names, no Zod issue structure
    expect(body).toEqual({ error: 'Validation error' })
    expect(body).not.toHaveProperty('issues')
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
        'x-reporte-secret': TEST_SECRET,
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
        'x-reporte-secret': TEST_SECRET,
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
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody({ tipo_org: 'cooperativa' })),
    })

    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
    const callArg = mockProvisionarCliente.mock.calls[0]![0]
    // cooperativa must be mapped to empresa at the schema boundary so the DB enum is never violated
    expect(callArg.tipoOrg).toBe('empresa')
  })
})

// ─── Trace contract (P4 observability) ───────────────────────────────────────

describe('POST /internal/provision-client — trace contract (P4)', () => {
  it('passes trace to provisionarCliente on success (yaExistia=false)', async () => {
    const mockTrace = { event: vi.fn() }
    const app = new Hono()
    const handler = createProvisionHandler({ secret: TEST_SECRET, trace: mockTrace })
    app.post('/internal/provision-client', handler)

    mockProvisionarCliente.mockResolvedValueOnce({
      orgId: 'ORG001',
      usuarioId: 'uuid-1',
      yaExistia: false,
    })

    await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody()),
    })

    // The handler must forward a trace adapter to provisionarCliente.
    // The adapter's .event method must have the positional (name, body) signature.
    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
    const [, deps] = mockProvisionarCliente.mock.calls[0]!
    expect(deps?.trace).toBeDefined()
    expect(typeof deps?.trace?.event).toBe('function')

    // The trace adapter must call through to the underlying trace.event on invocation.
    deps!.trace!.event('provision.created', { orgId: 'ORG001' })
    expect(mockTrace.event).toHaveBeenCalledWith('provision.created', { orgId: 'ORG001' })
  })

  it('passes trace to provisionarCliente on idempotent path (yaExistia=true)', async () => {
    const mockTrace = { event: vi.fn() }
    const app = new Hono()
    const handler = createProvisionHandler({ secret: TEST_SECRET, trace: mockTrace })
    app.post('/internal/provision-client', handler)

    mockProvisionarCliente.mockResolvedValueOnce({
      orgId: 'ORG002',
      usuarioId: 'uuid-2',
      yaExistia: true,
    })

    await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody()),
    })

    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
    const [, deps] = mockProvisionarCliente.mock.calls[0]!
    expect(deps?.trace).toBeDefined()
  })

  it('emits provision.error trace event with (name, body) when provisionarCliente throws', async () => {
    const mockTrace = { event: vi.fn() }
    const app = new Hono()
    const handler = createProvisionHandler({ secret: TEST_SECRET, trace: mockTrace })
    app.post('/internal/provision-client', handler)

    mockProvisionarCliente.mockRejectedValueOnce(new Error('DB connection failed'))

    const res = await app.request('/internal/provision-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-reporte-secret': TEST_SECRET,
      },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(500)
    // Handler must emit trace event with positional (name, body) shape (P4)
    expect(mockTrace.event).toHaveBeenCalledWith(
      'provision.error',
      expect.objectContaining({ error: expect.any(String) }),
    )
    // HTTP response must not leak internal error detail
    const body = await res.json()
    expect(body).toEqual({ error: 'Internal server error' })
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
        'x-reporte-secret': TEST_SECRET,
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
