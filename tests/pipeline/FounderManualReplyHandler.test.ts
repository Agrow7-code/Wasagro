import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NormalizedMessage } from '../../src/integrations/whatsapp/NormalizedMessage.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn(),
  getRecentOutboundInteracciones: vi.fn().mockResolvedValue([]),
  saveSDRInteraccion: vi.fn().mockResolvedValue(undefined),
  updateSDRProspecto: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn() }) },
}))

import { handleFounderManualReply } from '../../src/pipeline/handlers/FounderManualReplyHandler.js'
import * as queries from '../../src/pipeline/supabaseQueries.js'

const msgFromMe: NormalizedMessage = {
  wamid: 'wamid.fromme.001',
  from: '593987654321',
  timestamp: new Date('2026-07-01T12:00:00Z'),
  tipo: 'texto',
  texto: 'te contesto yo directo, ya vi tu mensaje',
  rawPayload: {},
  esFromMe: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleFounderManualReply (founder-crm PR5)', () => {
  it('(a) sdr_prospecto existe + contenido novedoso → loguea founder_override y bumpea ultima_interaccion', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-1', phone: '593987654321', turns_total: 3 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-a')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({
      prospecto_id: 'prospecto-1',
      phone: '593987654321',
      tipo: 'founder_override',
      contenido: msgFromMe.texto,
      action_taken: null,
    }))
    expect(queries.updateSDRProspecto).toHaveBeenCalledWith('prospecto-1', {})
  })

  it('(b) contenido coincide con un outbound reciente (eco de nuestro propio envío) → SKIP, no loguea de nuevo', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-2', phone: '593987654321', turns_total: 1 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([
      { contenido: msgFromMe.texto, tipo: 'outbound', created_at: '2026-07-01T11:59:30Z' },
    ])

    await handleFounderManualReply(msgFromMe, 'trace-b')

    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
    expect(queries.updateSDRProspecto).not.toHaveBeenCalled()
  })

  it('(c) no existe sdr_prospecto para el phone → ignorado, sin writes (field/farmer safety)', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(null)

    await handleFounderManualReply(msgFromMe, 'trace-c')

    expect(queries.getRecentOutboundInteracciones).not.toHaveBeenCalled()
    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
    expect(queries.updateSDRProspecto).not.toHaveBeenCalled()
  })

  it('(d) un fallo al persistir se traga (best-effort) — nunca lanza para no romper el webhook', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-4', phone: '593987654321', turns_total: 2 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])
    vi.mocked(queries.saveSDRInteraccion).mockRejectedValueOnce(new Error('db down'))

    await expect(handleFounderManualReply(msgFromMe, 'trace-d')).resolves.toBeUndefined()
  })

  it('(e) un fallo en el lookup inicial (getSDRProspecto) también se traga — nunca lanza', async () => {
    vi.mocked(queries.getSDRProspecto).mockRejectedValueOnce(new Error('db down'))

    await expect(handleFounderManualReply(msgFromMe, 'trace-e')).resolves.toBeUndefined()
    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
  })
})
