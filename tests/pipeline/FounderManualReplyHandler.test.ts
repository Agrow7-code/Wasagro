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
  it('(a) sdr_prospecto existe + contenido novedoso → loguea founder_override (action_taken=founder_phone_reply) y bumpea ultima_interaccion', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-1', phone: '593987654321', turns_total: 3 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-a')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({
      prospecto_id: 'prospecto-1',
      phone: '593987654321',
      tipo: 'founder_override',
      contenido: msgFromMe.texto,
      // Tags this row as written by THIS handler so getRecentOutboundInteracciones
      // excludes it from the echo-dedup source (R2/R3 fix) — a real API-send
      // echo (panel/bot/chaser/booking) would still be action_taken=null.
      action_taken: 'founder_phone_reply',
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

  // ─── FIX 3 gap closures — these encode the real contract, not vacuous asserts ───

  it('(kills mutant) recientes NO vacío pero el contenido NO coincide → saveSDRInteraccion SÍ se llama (no es un eco real)', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-mutant', phone: '593987654321', turns_total: 1 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([
      { contenido: 'un mensaje totalmente distinto', tipo: 'outbound', created_at: '2026-07-01T11:59:30Z' },
    ])

    await handleFounderManualReply(msgFromMe, 'trace-mutant')

    expect(queries.saveSDRInteraccion).toHaveBeenCalled()
  })

  it('llama a getRecentOutboundInteracciones con (prospectoId, ventana ISO derivada de DEDUP_WINDOW_MS) — nunca con msg.from', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-window', phone: '593987654321', turns_total: 0 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-window')

    // msgFromMe.timestamp = 2026-07-01T12:00:00Z; DEDUP_WINDOW_MS = 120_000 (2 min)
    expect(queries.getRecentOutboundInteracciones).toHaveBeenCalledWith('prospecto-window', '2026-07-01T11:58:00.000Z')
  })

  it('el turno pasado a saveSDRInteraccion es el turns_total del prospecto', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-turno', phone: '593987654321', turns_total: 7 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-turno')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({ turno: 7 }))
  })

  it('turns_total null → turno cae al fallback 0', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-turno-null', phone: '593987654321', turns_total: null })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-turno-null')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledWith(expect.objectContaining({ turno: 0 }))
  })
})

// ─── FIX 2 — self-echo dedup must not drop genuine repeated founder replies ───
//
// TIPOS_ECO_SALIENTE (supabaseQueries.ts) includes 'founder_override', which
// is the tipo THIS handler writes. getRecentOutboundInteracciones now
// excludes rows this handler tagged with action_taken='founder_phone_reply',
// so a 2nd identical founder phone reply must NOT self-echo-match the 1st.
// These tests exercise the handler contract assuming that exclusion holds
// (getRecentOutboundInteracciones returns empty, as the real query would
// after excluding the handler's own prior row).
describe('handleFounderManualReply — FIX2 self-echo dedup regression (founder-crm PR5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('(a) dos respuestas telefónicas consecutivas con texto idéntico dentro de la ventana → AMBAS se loguean', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-repeat', phone: '593987654321', turns_total: 2 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgFromMe, 'trace-repeat-1')
    await handleFounderManualReply(msgFromMe, 'trace-repeat-2')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledTimes(2)
  })

  it('(b) dos respuestas telefónicas consecutivas no-texto (imagen/voz) → AMBAS se loguean', async () => {
    const msgImagen: NormalizedMessage = { ...msgFromMe, tipo: 'imagen', wamid: 'wamid.fromme.img' }
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-img', phone: '593987654321', turns_total: 0 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([])

    await handleFounderManualReply(msgImagen, 'trace-img-1')
    await handleFounderManualReply(msgImagen, 'trace-img-2')

    expect(queries.saveSDRInteraccion).toHaveBeenCalledTimes(2)
  })

  it('(c) eco genuino de un envío bot/panel (tipo outbound, action_taken=null, contenido coincide) → sigue SKIPPED', async () => {
    vi.mocked(queries.getSDRProspecto).mockResolvedValue({ id: 'prospecto-realecho', phone: '593987654321', turns_total: 1 })
    vi.mocked(queries.getRecentOutboundInteracciones).mockResolvedValue([
      { contenido: msgFromMe.texto, tipo: 'outbound', action_taken: null, created_at: '2026-07-01T11:59:50Z' },
    ])

    await handleFounderManualReply(msgFromMe, 'trace-realecho')

    expect(queries.saveSDRInteraccion).not.toHaveBeenCalled()
  })
})
