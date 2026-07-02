// PR6 (founder-crm) — /admin/funnel route + "Funnel" nav link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App from '../../src/App'
import { AdminLayout } from '../../src/admin/AdminLayout'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

function setAuthedUser(rol: string) {
  localStorage.setItem(
    'wasagro_user',
    JSON.stringify({ id: 'u1', phone: '+593987654321', rol, nombre: 'Test User' }),
  )
}

function goTo(path: string) {
  window.history.pushState({}, 'Test', path)
}

describe('/admin/funnel route + nav link (PR6)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('AdminLayout nav renders a "Funnel" link to /admin/funnel', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /funnel/i })
    expect(link).toHaveAttribute('href', '/admin/funnel')
  })

  it('authenticated director navigating to /admin/funnel renders the Funnel kanban view', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    setAuthedUser('director')
    goTo('/admin/funnel')
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Funnel SDR')).toBeInTheDocument()
    })
  })
})
