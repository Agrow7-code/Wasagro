// T-S3.3 — ClientList view (landing/src/admin/ClientList.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ClientList } from '../../src/admin/ClientList'

const ORGS = [
  {
    org_id: 'ORG001',
    nombre: 'Bananera Puebloviejo',
    plan: 'productor',
    subscription_status: 'active',
    trial_inicio: null,
    trial_fin: null,
    fincas_count: 2,
    usuarios_count: 3,
    fincas_contratadas: 2,
    usuarios_contratados: 3,
    precio_mensual: 31,
  },
  {
    org_id: 'ORG002',
    nombre: 'Cacaotera San Marcos',
    plan: 'trial',
    subscription_status: null,
    trial_inicio: '2026-06-01T00:00:00Z',
    trial_fin: '2026-07-01T00:00:00Z',
    fincas_count: 1,
    usuarios_count: 1,
    fincas_contratadas: 1,
    usuarios_contratados: 1,
    precio_mensual: null,
  },
]

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<ClientList />} />
        <Route path="/admin/orgs/:id" element={<div>ORG DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientList (T-S3.3)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders a row per org with name, plan, and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORGS), { status: 200 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Bananera Puebloviejo')).toBeInTheDocument()
    })
    expect(screen.getByText('Cacaotera San Marcos')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 orgs
  })

  it('always shows the "Crear cliente" button, independent of data state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )
    renderWithRouter()

    expect(screen.getByRole('button', { name: /crear cliente/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /crear cliente/i })).toBeInTheDocument()
    })
  })

  it('clicking a row navigates to /admin/orgs/:id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ORGS), { status: 200 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Bananera Puebloviejo')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Bananera Puebloviejo'))

    await waitFor(() => {
      expect(screen.getByText('ORG DETAIL PAGE')).toBeInTheDocument()
    })
  })

  it('shows an error state when the API request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
})
