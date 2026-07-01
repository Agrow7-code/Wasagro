// T-S3.7 — anti-mock invariant: drill-in nav (ClientDetail + AdminLayout)
// exposes ONLY real-data views. Real drill-in links were already implemented
// directly in T-S3.5 (ClientDetail's fincaDrillInLinks) and T-S3.6
// (AdminLayout's NAV_LINKS) — this is the dedicated regression test the
// design's anti-mock invariant requires, guarding against a future add of a
// mock-view link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ClientDetail } from '../../src/admin/ClientDetail'
import { AdminLayout } from '../../src/admin/AdminLayout'

const MOCK_VIEW_PATHS = [
  '/dashboard/gerente',
  '/dashboard/exportadora',
  '/dashboard/agricultor',
  '/dashboard/calculadora',
  '/dashboard/insumos',
  '/dashboard/labor',
  '/dashboard/cosecha',
  '/dashboard/plagas',
  '/dashboard/clima',
  '/dashboard/gastos',
]

const REAL_VIEW_PREFIXES = ['/dashboard/sigatoka', '/dashboard/finca/setup', '/dashboard/billing']

const ORG_DETAIL = {
  org_id: 'ORG001',
  nombre: 'Bananera Puebloviejo',
  plan: 'productor',
  subscription_status: 'active',
  trial_inicio: null,
  trial_fin: null,
  fincas_contratadas: 1,
  usuarios_contratados: 1,
  precio_mensual: 18,
  fincas: [
    { finca_id: 'F001', nombre: 'Finca La Esperanza', cultivo_principal: 'banano', config: {} },
    { finca_id: 'F002', nombre: 'Finca El Roble', cultivo_principal: 'cacao', config: {} },
  ],
  usuarios: [],
}

describe('Drill-in nav anti-mock invariant (T-S3.7)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('ClientDetail: every finca drill-in link is exactly one real-view path, and Sigatoka carries ?finca_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORG_DETAIL), { status: 200 })),
    )
    render(
      <MemoryRouter initialEntries={['/admin/orgs/ORG001']}>
        <Routes>
          <Route path="/admin/orgs/:id" element={<ClientDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Finca La Esperanza')).toBeInTheDocument()
    })

    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      const matchesRealView = REAL_VIEW_PREFIXES.some((prefix) => href.startsWith(prefix))
      expect(matchesRealView).toBe(true)
      for (const mockPath of MOCK_VIEW_PATHS) {
        expect(href.startsWith(mockPath)).toBe(false)
      }
    }

    const sigatokaLinks = links.filter((l) => (l.getAttribute('href') ?? '').startsWith('/dashboard/sigatoka'))
    expect(sigatokaLinks).toHaveLength(2) // one per finca
    expect(sigatokaLinks[0]).toHaveAttribute('href', '/dashboard/sigatoka?finca_id=F001')
    expect(sigatokaLinks[1]).toHaveAttribute('href', '/dashboard/sigatoka?finca_id=F002')
  })

  it('AdminLayout nav does not contain any link to a mock view', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>,
    )

    const links = screen.getAllByRole('link')
    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      for (const mockPath of MOCK_VIEW_PATHS) {
        expect(href.startsWith(mockPath)).toBe(false)
      }
    }
  })
})
