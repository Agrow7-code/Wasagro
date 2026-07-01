import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase.js directly (same pattern as tests/auth/middleware.test.ts) so the
// real module — which throws at import time without SUPABASE_URL/SERVICE_ROLE_KEY —
// is never executed.
vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

import { Hono } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { supabase } from '../../../src/integrations/supabase.js'

function buildApp() {
  const app = new Hono()
  app.route('/api/admin', adminRouter)
  return app
}

// Thenable query-builder stub matching Supabase's chainable + awaitable contract:
// the real PostgrestFilterBuilder resolves when awaited directly (`.then()`), and
// also exposes `.single()` as its own awaitable. Chain methods return `this` so any
// call order the handler uses resolves to the same fixed `result`.
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

describe('GET /api/admin/orgs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with ACTUAL + CONTRACTUAL counts as integers, via a single DB call', async () => {
    const fromMock = vi.mocked(supabase.from)
    fromMock.mockReturnValueOnce(queryBuilder({
      data: [
        {
          org_id: 'ORG001',
          nombre: 'Bananera Puebloviejo',
          plan: 'agricultor',
          subscription_status: 'trial',
          trial_inicio: null,
          trial_fin: null,
          fincas_contratadas: 1,
          usuarios_contratados: 1,
          precio_mensual: 10,
          fincas: { count: 3 },
          usuarios: { count: 2 },
        },
      ],
      error: null,
    }) as ReturnType<typeof supabase.from>)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].fincas_count).toBe(3)
    expect(body[0].usuarios_count).toBe(2)
    expect(body[0].fincas_contratadas).toBe(1)
    expect(body[0].usuarios_contratados).toBe(1)
    // Never one query per org — exactly one supabase.from() call for the whole list.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('returns 200 with an empty array when no orgs exist', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(queryBuilder({ data: [], error: null }) as ReturnType<typeof supabase.from>)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe('GET /api/admin/orgs/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with fincas[] and usuarios[] (phones last-4 masked)', async () => {
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'organizaciones') {
        return queryBuilder({ data: { org_id: 'ORG001', nombre: 'Bananera Puebloviejo' }, error: null })
      }
      if (table === 'fincas') {
        return queryBuilder({ data: [{ finca_id: 'F001', nombre: 'Finca 1', cultivo_principal: 'banano', config: {} }], error: null })
      }
      if (table === 'usuarios') {
        return queryBuilder({ data: [{ id: 'u1', nombre: 'Carlos', rol: 'admin_org', phone: '593987654321' }], error: null })
      }
      return queryBuilder({ data: null, error: null })
    }) as typeof supabase.from)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs/ORG001')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.org_id).toBe('ORG001')
    expect(body.fincas).toHaveLength(1)
    expect(body.usuarios).toHaveLength(1)
    expect(body.usuarios[0].phone).toBe('****4321')
    // Raw phone must never reach the response.
    expect(JSON.stringify(body)).not.toContain('593987654321')
  })

  it('returns 404 for an unknown org_id (real not-found: data:null, error:null via maybeSingle)', async () => {
    vi.mocked(supabase.from).mockReturnValue(queryBuilder({ data: null, error: null }) as ReturnType<typeof supabase.from>)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs/ORG999')

    expect(res.status).toBe(404)
  })

  it('returns 500 (not 404) when the org lookup query itself fails', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      queryBuilder({ data: null, error: { message: 'connection reset' } }) as ReturnType<typeof supabase.from>,
    )

    const app = buildApp()
    const res = await app.request('/api/admin/orgs/ORG001')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal server error')
  })

  it('never selects or returns payment token fields (SAFE allowlist)', async () => {
    const orgBuilder = queryBuilder({
      data: {
        org_id: 'ORG001',
        nombre: 'Bananera Puebloviejo',
        plan: 'agricultor',
        subscription_status: 'trial',
        trial_inicio: null,
        trial_fin: null,
        fincas_contratadas: 1,
        usuarios_contratados: 1,
        precio_mensual: 10,
      },
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'organizaciones') return orgBuilder
      return queryBuilder({ data: [], error: null })
    }) as typeof supabase.from)

    const app = buildApp()
    const res = await app.request('/api/admin/orgs/ORG001')

    expect(res.status).toBe(200)
    const body = await res.json()
    const bodyStr = JSON.stringify(body)
    const forbiddenFields = [
      'dlocalgo_checkout_token',
      'dlocalgo_payment_id',
      'dlocal_card_id',
      'dlocal_payment_id',
      'stripe_customer_id',
      'stripe_subscription_id',
      'metodo_pago',
    ]
    for (const field of forbiddenFields) {
      expect(bodyStr).not.toContain(field)
    }

    // The SELECT itself must request only the safe allowlist — never '*'.
    const selectArg = (orgBuilder.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).not.toBe('*')
    for (const field of forbiddenFields) {
      expect(selectArg).not.toContain(field)
    }
  })
})
