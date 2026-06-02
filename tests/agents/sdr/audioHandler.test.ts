// FIX-3 — Audio inbound on SDR context.
//
// Real-prospect bug 2026-06-01: the prospect sent a voice note simulating
// a field data capture during the SDR pitch. The router fed the placeholder
// "[mensaje de voz o imagen]" string to the classifier + extractor and the
// pipeline crashed downstream, triggering the diplomatic catch in
// handleSDRSession that emits "Disculpá, tuve un problemita procesando tu
// mensaje". The prospect saw it three times in the same conversation.
//
// This test verifies that handleSDRSession with msg.tipo === 'audio'
// fast-paths to the audioAck template and never reaches the classifier or
// the diplomatic catch.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (must come before importing the SUT) ──────────────────────────────

const fakeRedis = new Map<string, string>()

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedis.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      fakeRedis.set(k, v)
      return 'OK'
    }),
  }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
  setIfNotExists: vi.fn(async () => true),
}))

vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  getSDRProspecto: vi.fn(),
  createSDRProspecto: vi.fn(),
  updateSDRProspecto: vi.fn(async () => {}),
  saveSDRInteraccion: vi.fn(async () => {}),
  getSDRProspectosPendingApproval: vi.fn(async () => []),
  actualizarMensaje: vi.fn(async () => {}),
}))

vi.mock('../../../src/workers/pgBoss.js', () => ({
  getBoss: () => ({ send: vi.fn(async () => 'jobid') }),
  isPgBossReady: () => false,
}))

vi.mock('../../../src/integrations/langfuse.js', () => {
  const noopGen = { end: () => {} }
  const noopTrace = { id: 'test-trace', event: () => {}, generation: () => noopGen }
  return { langfuse: { trace: () => noopTrace } }
})

// ─── SUT and helpers ─────────────────────────────────────────────────────────

import { handleSDRSession } from '../../../src/agents/sdrAgent.js'
import * as queries from '../../../src/pipeline/supabaseQueries.js'
import type { NormalizedMessage } from '../../../src/integrations/whatsapp/NormalizedMessage.js'

const PHONE = '593987654321'
const PROSPECT_ID = 'p-audio-1'

function seedRedisSession(fsmState: string): void {
  fakeRedis.set(`sdr_session:${PHONE}`, JSON.stringify({
    fsmState,
    lastBotAction: 'none',
    lastBotMessage: null,
    intentHistory: [],
    lastObjectionType: null,
    signalStrength: 'unknown',
    clarificationTurnsUsed: 0,
  }))
}

function prospectoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROSPECT_ID,
    phone: PHONE,
    sdr_node: 'discovery',
    turns_total: 1,
    fincas_en_cartera: 3,
    cultivo_principal: 'caña azucarera',
    pais: null,
    sistema_actual: null,
    segmento_icp: 'agricultor',
    source_context: 'landing',
    status: 'en_discovery',
    narrativa_asignada: 'A',
    ...overrides,
  }
}

function audioMessage(): NormalizedMessage {
  return {
    wamid: 'wamid.audio-1',
    from: PHONE,
    tipo: 'audio',
    audioUrl: 'http://media.evolution/aud1.opus' as any,
    timestamp: new Date(),
    rawPayload: {},
  } as NormalizedMessage
}

function makeSender() {
  return {
    enviarTexto: vi.fn(async (_phone: string, _text: string) => {}),
    enviarTemplate: vi.fn(async () => {}),
    enviarImagen: vi.fn(async () => {}),
    enviarDocumento: vi.fn(async () => {}),
  }
}

function makeLlm() {
  // None of these should be called on the audio fast-path. We still provide
  // mocks so a leak (an unexpected call) fails the test loudly.
  return {
    extraerDatosSDR: vi.fn(),
    redactarMensajeSDR: vi.fn(),
    clasificarIntencionSDR: vi.fn(),
    onboardarAdmin: vi.fn(),
    onboardarAgricultor: vi.fn(),
    resumirSemana: vi.fn(),
    extraerEvento: vi.fn(),
    clasificarTipoEvento: vi.fn(),
    extraerDocumentoOCR: vi.fn(),
    clasificarTipoImagen: vi.fn(),
    extraerObservacionPlaga: vi.fn(),
    clasificarExcel: vi.fn(),
    detectIntent: vi.fn(),
    atenderSDR: vi.fn(),
  }
}

const DIPLOMATIC_APOLOGY = /problemita procesando/i

beforeEach(() => {
  fakeRedis.clear()
  vi.clearAllMocks()
})

describe('handleSDRSession — audio inbound (FIX-3)', () => {
  it('cuando el prospecto manda audio en estado DISCOVERY → intent INTEREST, no error', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery' }))

    const sender = makeSender()
    const llm = makeLlm()

    await handleSDRSession(audioMessage(), 'mid-audio-1', 'trace-audio-1', sender as any, llm as any)

    // Audio fast-path bypasses both extractor and classifier — neither LLM
    // call must have happened.
    expect(llm.extraerDatosSDR).not.toHaveBeenCalled()
    expect(llm.redactarMensajeSDR).not.toHaveBeenCalled()

    // The audioAck template was sent — never the diplomatic apology.
    expect(sender.enviarTexto).toHaveBeenCalledOnce()
    const [, text] = sender.enviarTexto.mock.calls[0]!
    expect(text).toMatch(/audio/i)
    expect(text).not.toMatch(DIPLOMATIC_APOLOGY)

    // intentHistory was updated with 'interest' — verified via Redis re-persist.
    const stored = fakeRedis.get(`sdr_session:${PHONE}`)
    expect(stored, 'session state must be persisted at end of turn').toBeDefined()
    const next = JSON.parse(stored!)
    expect(next.intentHistory.at(-1)).toBe('interest')
  })

  it('cuando el prospecto manda audio en estado PITCH_SENT → avanza a CLOSING', async () => {
    seedRedisSession('pitch_sent')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({
      sdr_node: 'pitch',
      turns_total: 3,
    }))

    const sender = makeSender()
    const llm = makeLlm()

    await handleSDRSession(audioMessage(), 'mid-audio-2', 'trace-audio-2', sender as any, llm as any)

    // Classifier + extractor are bypassed on the audio path.
    expect(llm.redactarMensajeSDR).not.toHaveBeenCalled()

    // pitch_sent + interest -> closing per the FSM transition table.
    const stored = fakeRedis.get(`sdr_session:${PHONE}`)
    const next = JSON.parse(stored!)
    expect(next.fsmState).toBe('closing')

    // Response was sent — content uses audio acknowledgment, never apologizes.
    expect(sender.enviarTexto).toHaveBeenCalledOnce()
    const [, text] = sender.enviarTexto.mock.calls[0]!
    expect(text).not.toMatch(DIPLOMATIC_APOLOGY)
  })

  it('nunca muestra "tuve un problemita" por un audio en conversación SDR activa', async () => {
    // Same setup as test 1 but the assertion is the negative invariant.
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow())

    const sender = makeSender()
    const llm = makeLlm()

    await handleSDRSession(audioMessage(), 'mid-audio-3', 'trace-audio-3', sender as any, llm as any)

    // Every single message that left the bot in this turn must not contain
    // the diplomatic apology copy. If even one does, the regression is back.
    for (const call of sender.enviarTexto.mock.calls) {
      expect(call[1]).not.toMatch(DIPLOMATIC_APOLOGY)
    }
  })
})
