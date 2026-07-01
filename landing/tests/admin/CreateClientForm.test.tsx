// T-S3.4 — CreateClientForm (landing/src/admin/CreateClientForm.tsx).
//
// Body shape and status codes follow the ACTUAL shipped backend contract
// (src/agents/admin/router.ts, POST /api/admin/clients), not the older
// tasks.md wording: duplicate phone is 200 { ya_existia: true } (idempotent
// no-op), never 409. See CreateClientForm.tsx's own comment for the same
// note.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CreateClientForm } from '../../src/admin/CreateClientForm'

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/admin/clients/new']}>
      <Routes>
        <Route path="/admin/clients/new" element={<CreateClientForm />} />
        <Route path="/admin" element={<div>ADMIN LIST PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/nombre de la organización/i), { target: { value: 'Bananera San Marcos' } })
  fireEvent.change(screen.getByLabelText(/teléfono del administrador/i), { target: { value: '+593987654321' } })
  fireEvent.change(screen.getByLabelText(/nombre del administrador/i), { target: { value: 'Carlos López' } })
  fireEvent.change(screen.getByLabelText(/país/i), { target: { value: 'EC' } })
  fireEvent.change(screen.getByLabelText(/cultivo principal/i), { target: { value: 'banano' } })
  // consent_texto is pre-filled by default — left as-is.
}

describe('CreateClientForm (T-S3.4)', () => {
  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('submits POST /api/admin/clients with the filled body and navigates back on 201', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        nombre_org: 'Bananera San Marcos',
        telefono_admin: '+593987654321',
        nombre_admin: 'Carlos López',
        pais: 'EC',
        cultivo_principal: 'banano',
      })
      return new Response(JSON.stringify({ org_id: 'ORG010', usuario_id: 'uuid-1', ya_existia: false }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithRouter()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }))

    await waitFor(() => {
      expect(screen.getByText('ADMIN LIST PAGE')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('shows an inline notice (not a blocking error) when the phone already exists (200, ya_existia=true)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ org_id: 'ORG011', usuario_id: 'uuid-2', ya_existia: true }), { status: 200 })),
    )

    renderWithRouter()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }))

    await waitFor(() => {
      expect(screen.getByText(/ya (está|esta) registrad/i)).toBeInTheDocument()
    })
  })

  it('submit button is disabled while a required field is empty', () => {
    renderWithRouter()
    // Only nombre_org filled — the rest are empty.
    fireEvent.change(screen.getByLabelText(/nombre de la organización/i), { target: { value: 'Bananera San Marcos' } })

    expect(screen.getByRole('button', { name: /crear cliente/i })).toBeDisabled()
  })

  it('shows the backend error message on a 500 and re-enables the form (not stuck disabled)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'provisioning failed downstream' }), { status: 500 })),
    )

    renderWithRouter()
    fillRequiredFields()
    const submitBtn = screen.getByRole('button', { name: /crear cliente/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('provisioning failed downstream')).toBeInTheDocument()
    })
    expect(submitBtn).not.toBeDisabled()
  })

  it("shows the 'Respuesta inesperada del servidor' fallback on a malformed (non-JSON) failed response", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })))

    renderWithRouter()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }))

    await waitFor(() => {
      expect(screen.getByText('Respuesta inesperada del servidor')).toBeInTheDocument()
    })
  })

  it('submit button is disabled while the request is in-flight (no double submit)', async () => {
    let resolveFetch: (r: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    renderWithRouter()
    fillRequiredFields()
    const submitBtn = screen.getByRole('button', { name: /crear cliente/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(submitBtn).toBeDisabled()
    })

    resolveFetch!(new Response(JSON.stringify({ org_id: 'ORG012', usuario_id: 'uuid-3', ya_existia: false }), { status: 201 }))
  })
})
