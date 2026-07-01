// T-H4.2 (founder-crm PR4) — /admin/inbox route + nav badge (AdminLayout.tsx).
// Badge polls GET /conversaciones (no websockets) and shows the count of
// handoff_status='human_paused' conversations.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminLayout, POLL_INTERVAL_MS } from '../../src/admin/AdminLayout'

function conversaciones(pausedCount: number) {
  const rows = []
  for (let i = 0; i < pausedCount; i++) {
    rows.push({ id: `P${i}`, handoff_status: 'human_paused' })
  }
  rows.push({ id: 'P_bot', handoff_status: 'bot' })
  return rows
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout inbox nav + badge (T-H4.2)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('nav renders an Inbox link to /admin/inbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(conversaciones(0))))
    renderLayout()

    const link = screen.getByRole('link', { name: /inbox/i })
    expect(link).toHaveAttribute('href', '/admin/inbox')
  })

  it('badge is hidden when no conversations are paused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(conversaciones(0))))
    renderLayout()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument()
    })
    expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument()
  })

  it('badge shows the count of paused conversations and refreshes on a polling interval', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      const pausedCount = calls === 1 ? 1 : 3
      return jsonResponse(conversaciones(pausedCount))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    renderLayout()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('inbox-badge')).toHaveTextContent('1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    })
    expect(screen.getByTestId('inbox-badge')).toHaveTextContent('3')
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
