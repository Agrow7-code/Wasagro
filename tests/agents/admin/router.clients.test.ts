import { describe, expect, it, vi, beforeEach } from 'vitest'

// supabaseQueries is imported transitively by provisionarCliente.ts; mock it so
// the real supabase.ts (which throws without env vars) never executes — same
// pattern as tests/agents/provisioning/provisionEndpoint.test.ts.
vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  getUserByPhone: vi.fn(),
  provisionarClienteAtomico: vi.fn(),
}))

vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

// Spread real named exports (ProvisionInputSchema, createProvisionHandler) while
// replacing only provisionarCliente, so the test controls its return value AND
// can assert createProvisionHandler is never touched by the admin router.
vi.mock('../../../src/agents/provisioning/provisionarCliente.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/agents/provisioning/provisionarCliente.js')>()
  return {
    ...original,
    provisionarCliente: vi.fn(),
    createProvisionHandler: vi.fn(() => {
      throw new Error('createProvisionHandler must NEVER be called from the admin router (REPORTE_SECRET path)')
    }),
  }
})

import { Hono } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { provisionarCliente, createProvisionHandler } from '../../../src/agents/provisioning/provisionarCliente.js'

const mockProvisionarCliente = vi.mocked(provisionarCliente)
const mockCreateProvisionHandler = vi.mocked(createProvisionHandler)

function buildApp() {
  const app = new Hono()
  app.route('/api/admin', adminRouter)
  return app
}

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/clients', () => {
  it('calls provisionarCliente() with the parsed input and returns 201 on create', async () => {
    mockProvisionarCliente.mockResolvedValueOnce({ orgId: 'ORG010', usuarioId: 'uuid-1', yaExistia: false })

    const app = buildApp()
    const res = await app.request('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.org_id).toBe('ORG010')
    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
    expect(mockCreateProvisionHandler).not.toHaveBeenCalled()
  })

  it('returns 200 with ya_existia=true on duplicate phone (idempotent no-op)', async () => {
    mockProvisionarCliente.mockResolvedValueOnce({ orgId: 'ORG011', usuarioId: 'uuid-2', yaExistia: true })

    const app = buildApp()
    const res = await app.request('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ya_existia).toBe(true)
  })

  it('returns 400 on missing nombre_org and does NOT call provisionarCliente', async () => {
    const body = validBody()
    delete (body as Record<string, unknown>)['nombre_org']

    const app = buildApp()
    const res = await app.request('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(400)
    expect(mockProvisionarCliente).not.toHaveBeenCalled()
  })

  it('ignores the x-reporte-secret header entirely — never imports/calls createProvisionHandler', async () => {
    mockProvisionarCliente.mockResolvedValueOnce({ orgId: 'ORG012', usuarioId: 'uuid-3', yaExistia: false })

    const app = buildApp()
    const res = await app.request('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-reporte-secret': 'some-secret-value' },
      body: JSON.stringify(validBody()),
    })

    expect(res.status).toBe(201)
    expect(mockCreateProvisionHandler).not.toHaveBeenCalled()
    expect(mockProvisionarCliente).toHaveBeenCalledOnce()
  })
})
