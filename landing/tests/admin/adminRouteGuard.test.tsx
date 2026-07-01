// T-S3.2 — /admin protected route tree (App.tsx + AdminLayout.tsx stub).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../src/App'

// Mirrors main.tsx's provider wiring — several dashboard views (e.g. the
// /dashboard index route a non-director gerente redirect lands on) call
// useQuery and crash without a QueryClientProvider ancestor.
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

describe('/admin route tree (T-S3.2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('unauthenticated user navigating to /admin is redirected to /login', async () => {
    goTo('/admin')
    renderApp()

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login')
    })
  })

  it('authenticated non-director (gerente) navigating to /admin is redirected to /dashboard', async () => {
    setAuthedUser('gerente')
    goTo('/admin')
    renderApp()

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard')
    })
  })

  it('authenticated director navigating to /admin renders AdminLayout', async () => {
    setAuthedUser('director')
    goTo('/admin')
    renderApp()

    await waitFor(() => {
      expect(screen.getByTestId('admin-layout')).toBeInTheDocument()
    })
  })
})
