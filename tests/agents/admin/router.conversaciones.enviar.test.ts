import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase.js directly (same pattern as router.conversaciones.pause.test.ts)
// so the real module — which throws at import time without
// SUPABASE_URL/SERVICE_ROLE_KEY — is never executed.
vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  setHandoffEstado: vi.fn().mockResolvedValue(undefined),
  getConversacionesList: vi.fn(),
  getConversacionThread: vi.fn(),
  getSDRProspectoById: vi.fn(),
  saveSDRInteraccion: vi.fn().mockResolvedValue(undefined),
}))

const mockEnviarTexto = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../src/integrations/whatsapp/index.js', () => ({
  crearSenderWhatsApp: vi.fn(() => ({ enviarTexto: mockEnviarTexto })),
}))

import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { adminRouter } from '../../../src/agents/admin/router.js'
import { roleGuard } from '../../../src/auth/roleGuard.js'
import {
  getSDRProspectoById,
  saveSDRInteraccion,
  setHandoffEstado,
} from '../../../src/pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../../../src/integrations/whatsapp/index.js'

const mockGetSDRProspectoById = vi.mocked(getSDRProspectoById)
const mockSaveSDRInteraccion = vi.mocked(saveSDRInteraccion)
const mockSetHandoffEstado = vi.mocked(setHandoffEstado)
const mockCrearSenderWhatsApp = vi.mocked(crearSenderWhatsApp)

// Mirrors the production mount order in src/index.ts.
function buildApp(authedUser: unknown = { rol: 'director' }) {
  const app = new Hono()
  app.use('/api/admin/*', async (c: Context, next: Next) => {
    c.set('authedUser', authedUser)
    await next()
  })
  app.use('/api/admin/*', roleGuard)
  app.route('/api/admin', adminRouter)
  return app
}

const PROSPECTO = {
  id: 'p1',
  phone: '593987654321',
  nombre: 'Carlos',
  turns_total: 4,
  handoff_status: 'bot',
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/admin/conversaciones/:id/enviar', () => {
  it('director sends a valid message: sender called, interaction persisted, phone never in response', async () => {
    mockGetSDRProspectoById.mockResolvedValueOnce({ ...PROSPECTO })

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Hola, soy Henry' }),
    })

    expect(res.status).toBe(200)
    expect(mockCrearSenderWhatsApp).toHaveBeenCalledOnce()
    expect(mockEnviarTexto).toHaveBeenCalledWith('593987654321', 'Hola, soy Henry')
    expect(mockSaveSDRInteraccion).toHaveBeenCalledWith({
      prospecto_id: 'p1',
      phone: '593987654321',
      turno: 4,
      tipo: 'founder_override',
      contenido: 'Hola, soy Henry',
      action_taken: null,
    })

    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain('593987654321')
  })

  it('non-director is rejected with 403, sender NOT called', async () => {
    const app = buildApp({ rol: 'gerente' })
    const res = await app.request('/api/admin/conversaciones/p1/enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Hola' }),
    })

    expect(res.status).toBe(403)
    expect(mockCrearSenderWhatsApp).not.toHaveBeenCalled()
    expect(mockEnviarTexto).not.toHaveBeenCalled()
  })

  it('conversation is human_paused: send still succeeds, handoff_status left unchanged (no auto-resume)', async () => {
    mockGetSDRProspectoById.mockResolvedValueOnce({ ...PROSPECTO, handoff_status: 'human_paused' })

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Hola, soy Henry' }),
    })

    expect(res.status).toBe(200)
    expect(mockEnviarTexto).toHaveBeenCalledOnce()
    expect(mockSetHandoffEstado).not.toHaveBeenCalled()
  })

  it('empty/missing mensaje returns 400, sender NOT called', async () => {
    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/p1/enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: '' }),
    })

    expect(res.status).toBe(400)
    expect(mockCrearSenderWhatsApp).not.toHaveBeenCalled()
    expect(mockEnviarTexto).not.toHaveBeenCalled()
    expect(mockGetSDRProspectoById).not.toHaveBeenCalled()
  })

  it('unknown :id returns 404, sender NOT called', async () => {
    mockGetSDRProspectoById.mockResolvedValueOnce(null)

    const app = buildApp({ rol: 'director' })
    const res = await app.request('/api/admin/conversaciones/unknown-id/enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Hola' }),
    })

    expect(res.status).toBe(404)
    expect(mockEnviarTexto).not.toHaveBeenCalled()
  })
})
