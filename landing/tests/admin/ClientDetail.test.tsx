// T-S3.5 — ClientDetail view (landing/src/admin/ClientDetail.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ClientDetail } from '../../src/admin/ClientDetail'

const ORG_DETAIL = {
  org_id: 'ORG001',
  nombre: 'Bananera Puebloviejo',
  plan: 'productor',
  subscription_status: 'active',
  trial_inicio: null,
  trial_fin: null,
  fincas_contratadas: 2,
  usuarios_contratados: 3,
  precio_mensual: 31,
  fincas: [
    { finca_id: 'F001', nombre: 'Finca La Esperanza', cultivo_principal: 'banano', config: {} },
  ],
  usuarios: [
    { id: 'u1', nombre: 'Carlos López', rol: 'admin_org', phone: '****4321' },
  ],
}

function renderAt(orgId: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/orgs/${orgId}`]}>
      <Routes>
        <Route path="/admin/orgs/:id" element={<ClientDetail />} />
        <Route path="/admin" element={<div>ADMIN LIST PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientDetail (T-S3.5)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders org metadata, fincas, and users (phones already last-4 masked, rendered as-is)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORG_DETAIL), { status: 200 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText('Bananera Puebloviejo')).toBeInTheDocument()
    })
    expect(screen.getByText('Finca La Esperanza')).toBeInTheDocument()
    expect(screen.getByText('Carlos López')).toBeInTheDocument()
    expect(screen.getByText('****4321')).toBeInTheDocument()
  })

  it('unknown org_id (404) renders a "not found" message, not a blank/crashed screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Org not found' }), { status: 404 })),
    )
    renderAt('ORG999')

    await waitFor(() => {
      expect(screen.getByText(/no encontrad/i)).toBeInTheDocument()
    })
  })

  it('each finca row renders a drill-in link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORG_DETAIL), { status: 200 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText('Finca La Esperanza')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /sigatoka/i })).toHaveAttribute(
      'href',
      '/dashboard/sigatoka?finca_id=F001',
    )
  })

  it('a 500 (not 404) response renders the generic error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
  })

  it('surfaces the backend error body instead of a generic status message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'org detail query failed downstream' }), { status: 500 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText('org detail query failed downstream')).toBeInTheDocument()
    })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 500 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText(/error 500 cargando el cliente/i)).toBeInTheDocument()
    })
  })

  it('"Volver" link navigates back to /admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORG_DETAIL), { status: 200 })),
    )
    renderAt('ORG001')

    await waitFor(() => {
      expect(screen.getByText('Bananera Puebloviejo')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/volver/i))

    await waitFor(() => {
      expect(screen.getByText('ADMIN LIST PAGE')).toBeInTheDocument()
    })
  })
})
