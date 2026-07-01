import { describe, expect, it, vi, beforeEach } from 'vitest'

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

describe('GET /api/admin/sdr', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with every phone last-4 masked — raw phone never appears in the response', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(queryBuilder({
      data: [
        {
          id: 'p1', nombre: 'Carlos', empresa: null, phone: '593987654321',
          status: 'en_discovery', turns_total: 4, calcom_booking_id: null,
          created_at: '2026-06-01T00:00:00Z',
        },
        {
          id: 'p2', nombre: null, empresa: 'Bananera del Norte', phone: '593900000002',
          status: 'qualified', turns_total: 9, calcom_booking_id: 'cal-123',
          created_at: '2026-06-02T00:00:00Z',
        },
      ],
      error: null,
    }) as ReturnType<typeof supabase.from>)

    const app = buildApp()
    const res = await app.request('/api/admin/sdr')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    for (const row of body) {
      expect(row.phone).toMatch(/^(\*{4}|\*{4}\d{4})$/)
    }
    expect(JSON.stringify(body)).not.toContain('593987654321')
    expect(JSON.stringify(body)).not.toContain('593900000002')
  })

  it('returns 200 with an empty array when no prospects exist', async () => {
    vi.mocked(supabase.from).mockReturnValueOnce(queryBuilder({ data: [], error: null }) as ReturnType<typeof supabase.from>)

    const app = buildApp()
    const res = await app.request('/api/admin/sdr')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
