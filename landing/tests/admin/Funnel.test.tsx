// T-Funnel (founder-crm PR6) — read-only SDR funnel kanban
// (landing/src/admin/Funnel.tsx). Reuses the existing
// GET /api/admin/conversaciones endpoint (same one Inbox.tsx uses) and
// groups the rows by `status` on the client — no new backend, no write.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Funnel } from '../../src/admin/Funnel'

const CONVERSACIONES = [
  {
    id: 'PROSP001',
    phone: '***0830',
    nombre: 'Henry Morales',
    empresa: 'Bananera Puebloviejo',
    status: 'new',
    handoff_status: 'human_paused',
    handoff_reason: 'auto_human_request',
    ultima_interaccion: '2026-07-01T10:00:00Z',
    needs_attention: true,
  },
  {
    id: 'PROSP002',
    phone: '***1234',
    nombre: 'Ana Ruiz',
    empresa: 'Cacaotera San Marcos',
    status: 'qualified',
    handoff_status: 'bot',
    handoff_reason: null,
    ultima_interaccion: '2026-07-01T09:00:00Z',
    needs_attention: false,
  },
  {
    id: 'PROSP003',
    phone: '***5678',
    nombre: null,
    empresa: null,
    status: 'reunion_agendada',
    handoff_status: 'bot',
    handoff_reason: null,
    ultima_interaccion: '2026-06-30T09:00:00Z',
    needs_attention: false,
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderFunnel() {
  return render(
    <MemoryRouter initialEntries={['/admin/funnel']}>
      <Routes>
        <Route path="/admin/funnel" element={<Funnel />} />
      </Routes>
    </MemoryRouter>,
  )
}

function columnByStatus(status: string): HTMLElement {
  const columns = screen.getAllByTestId('funnel-column')
  const found = columns.find((col) => col.getAttribute('data-status') === status)
  if (!found) throw new Error(`No column found for status "${status}"`)
  return found
}

describe('Funnel (PR6)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('groups prospects across different status values into their matching columns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        return jsonResponse([])
      }),
    )
    renderFunnel()

    await waitFor(() => {
      expect(screen.getAllByTestId('funnel-card')).toHaveLength(3)
    })

    expect(within(columnByStatus('new')).getByText('Henry Morales')).toBeInTheDocument()
    expect(within(columnByStatus('qualified')).getByText('Ana Ruiz')).toBeInTheDocument()
    // PROSP003 has no `nombre` — the card falls back to rendering the phone,
    // which then also appears a second time in the dedicated phone line.
    expect(within(columnByStatus('reunion_agendada')).getAllByText('***5678')).toHaveLength(2)
  })

  it('a column with zero prospects still renders (empty column, not missing)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        return jsonResponse([])
      }),
    )
    renderFunnel()

    await waitFor(() => {
      expect(screen.getAllByTestId('funnel-card')).toHaveLength(3)
    })

    const enDiscovery = columnByStatus('en_discovery')
    expect(enDiscovery).toBeInTheDocument()
    expect(within(enDiscovery).getByTestId('funnel-column-count')).toHaveTextContent('0')
    expect(within(enDiscovery).queryAllByTestId('funnel-card')).toHaveLength(0)
  })

  it('a prospect with an unrecognized status lands in the "Otros" column', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) {
          return jsonResponse([
            ...CONVERSACIONES,
            {
              id: 'PROSP004',
              phone: '***9999',
              nombre: 'Zoe Extraña',
              empresa: null,
              status: 'some_future_status',
              handoff_status: 'bot',
              handoff_reason: null,
              ultima_interaccion: '2026-07-01T11:00:00Z',
              needs_attention: false,
            },
          ])
        }
        return jsonResponse([])
      }),
    )
    renderFunnel()

    await waitFor(() => {
      expect(screen.getAllByTestId('funnel-card')).toHaveLength(4)
    })

    const otros = columnByStatus('otros')
    expect(within(otros).getByText('Zoe Extraña')).toBeInTheDocument()
    expect(within(otros).getByText('Otros')).toBeInTheDocument()
  })

  it('shows an error state when the API call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Internal server error' }, 500)),
    )
    renderFunnel()

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
    })
    expect(screen.queryAllByTestId('funnel-column')).toHaveLength(0)
  })

  it('visually flags a needs_attention card with the specific, actionable label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        return jsonResponse([])
      }),
    )
    renderFunnel()

    await waitFor(() => {
      expect(screen.getAllByTestId('funnel-card')).toHaveLength(3)
    })

    const cards = screen.getAllByTestId('funnel-card')
    const flagged = cards.filter((card) => card.getAttribute('data-needs-attention') === 'true')
    expect(flagged).toHaveLength(1)
    expect(within(flagged[0]).getByText('Henry Morales')).toBeInTheDocument()
    expect(within(flagged[0]).getByText(/pidió hablar con una persona/i)).toBeInTheDocument()
  })
})
