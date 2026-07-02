// T-H4.1 (founder-crm PR4) — Inbox view (landing/src/admin/Inbox.tsx).
// List pane + thread pane + pause/resume + send box, reusing the
// authFetch/VITE_API_URL + loading/error/data pattern from ClientList.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Inbox } from '../../src/admin/Inbox'

const CONVERSACIONES = [
  {
    id: 'PROSP001',
    phone: '***0830',
    nombre: 'Henry Morales',
    empresa: 'Bananera Puebloviejo',
    status: 'active',
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
    status: 'active',
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
    status: 'active',
    handoff_status: 'bot',
    handoff_reason: null,
    ultima_interaccion: '2026-06-30T09:00:00Z',
    needs_attention: false,
  },
  {
    id: 'PROSP004',
    phone: '***9999',
    nombre: 'Luis Paredes',
    empresa: 'Cacaotera El Roble',
    status: 'active',
    handoff_status: 'human_paused',
    handoff_reason: 'manual',
    ultima_interaccion: '2026-07-01T08:00:00Z',
    needs_attention: true,
  },
]

const THREAD = [
  { id: 'M1', created_at: '2026-07-01T09:58:00Z', origen: 'mensajes_entrada', direction: 'inbound', contenido_raw: 'Quiero hablar con alguien' },
  { id: 'I1', created_at: '2026-07-01T09:59:00Z', origen: 'sdr_interacciones', direction: 'outbound', contenido: 'Ya te comunico con el equipo.' },
  { id: 'M2', created_at: '2026-07-01T10:00:00Z', origen: 'mensajes_entrada', direction: 'inbound', contenido_raw: 'Gracias' },
]

const THREAD_CON_MEDIA = [
  {
    id: 'M1', created_at: '2026-07-01T09:58:00Z', origen: 'mensajes_entrada', direction: 'inbound',
    contenido: '[audio o imagen]', media_url: 'https://signed.example/foto.jpg', media_tipo: 'image',
  },
  {
    id: 'M2', created_at: '2026-07-01T09:59:00Z', origen: 'mensajes_entrada', direction: 'inbound',
    contenido: '[audio o imagen]', media_url: 'https://signed.example/nota.ogg', media_tipo: 'audio',
  },
  { id: 'M3', created_at: '2026-07-01T10:00:00Z', origen: 'mensajes_entrada', direction: 'inbound', contenido_raw: 'Gracias' },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/admin/inbox']}>
      <Routes>
        <Route path="/admin/inbox" element={<Inbox />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Inbox (T-H4.1)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders one row per conversation and visually flags needs_attention rows with a specific, actionable label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        return jsonResponse([])
      }),
    )
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })

    const rows = screen.getAllByTestId('conv-row')
    const flagged = rows.filter((row) => row.getAttribute('data-needs-attention') === 'true')
    expect(flagged).toHaveLength(2)

    // PROSP001: paused via prospect's own request → specific label.
    const henryRow = flagged.find((row) => within(row).queryByText('Henry Morales'))!
    expect(within(henryRow).getByText(/pidió hablar con una persona/i)).toBeInTheDocument()

    // PROSP004: paused manually by the founder → different label.
    const luisRow = flagged.find((row) => within(row).queryByText('Luis Paredes'))!
    expect(within(luisRow).getByText(/en pausa \(la tomaste tú\)/i)).toBeInTheDocument()

    // PROSP002/PROSP003 (handoff_status 'bot') render NO attention marker.
    const anaRow = rows.find((row) => within(row).queryByText('Ana Ruiz'))!
    expect(within(anaRow).queryByText(/pidió hablar|en pausa/i)).not.toBeInTheDocument()
  })

  it('auto-opens the conversation from ?conv= (deep-link from the funnel)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        if (url.includes('/admin/conversaciones/PROSP002/mensajes')) return jsonResponse(THREAD)
        return jsonResponse([])
      }),
    )
    render(
      <MemoryRouter initialEntries={['/admin/inbox?conv=PROSP002']}>
        <Routes>
          <Route path="/admin/inbox" element={<Inbox />} />
        </Routes>
      </MemoryRouter>,
    )

    // No manual click — the thread for PROSP002 loads from the query param alone.
    await waitFor(() => {
      expect(screen.getAllByTestId('thread-item')).toHaveLength(THREAD.length)
    })
    expect(screen.getByText('Ya te comunico con el equipo.')).toBeInTheDocument()
  })

  it('clicking a row fetches the thread and renders it chronologically', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        if (url.endsWith('/admin/conversaciones/PROSP001/mensajes')) return jsonResponse(THREAD)
        return jsonResponse([])
      }),
    )
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Henry Morales'))

    await waitFor(() => {
      expect(screen.getAllByTestId('thread-item')).toHaveLength(3)
    })
    const items = screen.getAllByTestId('thread-item')
    expect(within(items[0]).getByText('Quiero hablar con alguien')).toBeInTheDocument()
    expect(within(items[1]).getByText('Ya te comunico con el equipo.')).toBeInTheDocument()
    expect(within(items[2]).getByText('Gracias')).toBeInTheDocument()
  })

  it('renders inbound and outbound messages with visibly distinct sender treatment (BUG A)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        if (url.endsWith('/admin/conversaciones/PROSP001/mensajes')) return jsonResponse(THREAD)
        return jsonResponse([])
      }),
    )
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Henry Morales'))

    await waitFor(() => {
      expect(screen.getAllByTestId('thread-item')).toHaveLength(3)
    })
    const items = screen.getAllByTestId('thread-item')

    // M1 (inbound) and I1 (outbound) must carry a distinct direction + sender label.
    expect(items[0].getAttribute('data-direction')).toBe('inbound')
    expect(items[1].getAttribute('data-direction')).toBe('outbound')
    expect(within(items[0]).getByText('Prospecto')).toBeInTheDocument()
    expect(within(items[1]).getByText(/wasagro/i)).toBeInTheDocument()
    // The sender label must actually differ between the two rows.
    const senderLabels = items.map((item) => item.querySelector('[data-testid="thread-sender"]')?.textContent)
    expect(senderLabels[0]).not.toBe(senderLabels[1])
  })

  it('pause/resume button calls the POST route and reflects the new state without a full reload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
      if (url.endsWith('/admin/conversaciones/PROSP001/mensajes')) return jsonResponse(THREAD)
      if (url.endsWith('/admin/conversaciones/PROSP001/resume') && init?.method === 'POST') {
        return jsonResponse({ status: 'resumed' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Henry Morales'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reanudar/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /reanudar/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([reqUrl, reqInit]) =>
            reqUrl.toString().endsWith('/admin/conversaciones/PROSP001/resume') &&
            (reqInit as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pausar$/i })).toBeInTheDocument()
    })
  })

  it('send box: submits, calls /enviar, and clears the input on success', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
      if (url.endsWith('/admin/conversaciones/PROSP002/mensajes')) return jsonResponse([])
      if (url.endsWith('/admin/conversaciones/PROSP002/enviar') && init?.method === 'POST') {
        return jsonResponse({ status: 'sent' })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Ana Ruiz'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/escribe un mensaje/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/escribe un mensaje/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Hola, ya reviso tu caso' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([reqUrl]) => reqUrl.toString().endsWith('/admin/conversaciones/PROSP002/enviar')),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('send box: on API error shows an inline error and does NOT clear the input', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
      if (url.endsWith('/admin/conversaciones/PROSP002/mensajes')) return jsonResponse([])
      if (url.endsWith('/admin/conversaciones/PROSP002/enviar') && init?.method === 'POST') {
        return jsonResponse({ error: 'Internal server error' }, 500)
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Ana Ruiz'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/escribe un mensaje/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/escribe un mensaje/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Hola, ya reviso tu caso' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
    })
    expect(input.value).toBe('Hola, ya reviso tu caso')
  })

  it('thread items with media_url render the actual media instead of the text placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.endsWith('/admin/conversaciones')) return jsonResponse(CONVERSACIONES)
        if (url.endsWith('/admin/conversaciones/PROSP001/mensajes')) return jsonResponse(THREAD_CON_MEDIA)
        return jsonResponse([])
      }),
    )
    renderInbox()

    await waitFor(() => {
      expect(screen.getAllByTestId('conv-row')).toHaveLength(4)
    })
    fireEvent.click(screen.getByText('Henry Morales'))

    await waitFor(() => {
      expect(screen.getAllByTestId('thread-item')).toHaveLength(3)
    })
    const items = screen.getAllByTestId('thread-item')

    // M1: image → <img>
    const img = within(items[0]).getByRole('img')
    expect(img).toHaveAttribute('src', 'https://signed.example/foto.jpg')

    // M2: audio → <audio controls>
    const audio = items[1].querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio).toHaveAttribute('src', 'https://signed.example/nota.ogg')
    expect(audio).toHaveAttribute('controls')

    // M3: plain text, unchanged
    expect(within(items[2]).getByText('Gracias')).toBeInTheDocument()
    expect(items[2].querySelector('img')).toBeNull()
    expect(items[2].querySelector('audio')).toBeNull()
  })
})
