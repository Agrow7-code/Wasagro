// T-S3.6 — SdrFunnel view (landing/src/admin/SdrFunnel.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SdrFunnel } from '../../src/admin/SdrFunnel'

const PROSPECTOS = [
  { id: 'p1', nombre: 'Juan Pérez', phone: '****4321', estado: 'meeting_confirmed', turns_total: 5, calcom_booking_id: 'bk1', created_at: '2026-06-28T10:00:00Z' },
  { id: 'p2', nombre: 'María Torres', phone: '****9999', estado: 'nurturing', turns_total: 2, calcom_booking_id: null, created_at: '2026-06-27T10:00:00Z' },
  { id: 'p3', nombre: 'Empresa Agro SA', phone: '****1111', estado: 'new', turns_total: 1, calcom_booking_id: null, created_at: '2026-06-26T10:00:00Z' },
]

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/admin/sdr']}>
      <SdrFunnel />
    </MemoryRouter>,
  )
}

describe('SdrFunnel (T-S3.6)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders a row per prospect with an already-masked phone (never the full number in the DOM)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(PROSPECTOS), { status: 200 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    })
    expect(screen.getByText('María Torres')).toBeInTheDocument()
    expect(screen.getByText('Empresa Agro SA')).toBeInTheDocument()

    const phoneCells = screen.getAllByText(/^\*{4}\d{4}$/)
    expect(phoneCells).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(/\+\d{6,}/) // no full E.164 phone anywhere
  })

  it('shows an error state when the API request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
  })

  it('surfaces the backend error body instead of a generic status message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'sdr query failed downstream' }), { status: 500 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('sdr query failed downstream')).toBeInTheDocument()
    })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 500 })),
    )
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText(/error 500 cargando prospectos/i)).toBeInTheDocument()
    })
  })
})
