// FEATURE — SDR audio transcription (branch feat/sdr-audio-transcription)
//
// handleAudioInbound previously never transcribed the prospect's voice note —
// it always synthesized a fixed intent='interest' classification and replied
// with the canned audioAck template (see audioHandler.test.ts, FIX-3). This
// suite verifies the NEW behavior: STT (D4 Deepgram, transcribirAudio) is
// attempted first; on success the transcript is routed through the SAME text
// pipeline (classify -> extract -> FSM -> reply) as a typed message, and the
// canned audioAck-only path is skipped. On STT failure/empty transcript, the
// flow degrades gracefully to the pre-existing synthesized-interest fallback
// (never throws — P4).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (must come before importing the SUT) ──────────────────────────────

const fakeRedis = new Map<string, string>()

// FIX 2 (R3): captures langfuse trace().event() calls so tests can assert
// sdr_audio_received fires on every audio turn (success AND fallback).
const capturedTraceEvents: Array<{ name: string; level?: string; input?: unknown }> = []

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
  const noopTrace = {
    id: 'test-trace',
    event: (e: { name: string; level?: string; input?: unknown }) => { capturedTraceEvents.push(e) },
    generation: () => noopGen,
  }
  return { langfuse: { trace: () => noopTrace } }
})

vi.mock('../../../src/pipeline/sttService.js', () => ({
  transcribirAudio: vi.fn(),
}))

// ─── SUT and helpers (imported after mocks) ──────────────────────────────────

import { handleSDRSession } from '../../../src/agents/sdrAgent.js'
import { resetClassifierCache } from '../../../src/agents/sdr/classifier.js'
import { persistSessionState } from '../../../src/agents/sdr/contextStore.js'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'
import * as queries from '../../../src/pipeline/supabaseQueries.js'
import { transcribirAudio } from '../../../src/pipeline/sttService.js'
import type { ILLMAdapter } from '../../../src/integrations/llm/ILLMAdapter.js'
import type { IWasagroLLM } from '../../../src/integrations/llm/IWasagroLLM.js'
import type { NormalizedMessage } from '../../../src/integrations/whatsapp/NormalizedMessage.js'

const PHONE = '593987654322'
const PROSPECT_ID = 'p-audio-stt-1'
const TRANSCRIPT = 'Sí, me interesa avanzar con la demo'

function seedRedisSession(fsmState: string, overrides: Record<string, unknown> = {}): void {
  fakeRedis.set(`sdr_session:${PHONE}`, JSON.stringify({
    fsmState,
    lastBotAction: 'sent_pitch',
    lastBotMessage: 'pitch previo',
    intentHistory: [],
    lastObjectionType: null,
    signalStrength: 'warm',
    clarificationTurnsUsed: 0,
    ...overrides,
  }))
}

function prospectoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROSPECT_ID,
    phone: PHONE,
    sdr_node: 'pitch',
    turns_total: 3,
    fincas_en_cartera: 3,
    cultivo_principal: 'cacao',
    pais: 'Ecuador',
    sistema_actual: 'papel',
    segmento_icp: 'agricultor',
    source_context: 'landing',
    status: 'en_discovery',
    narrativa_asignada: 'A',
    ...overrides,
  }
}

function audioMessage(): NormalizedMessage {
  return {
    wamid: 'wamid.audio-stt-1',
    from: PHONE,
    tipo: 'audio',
    audioUrl: 'http://media.evolution/aud-stt-1.opus' as any,
    timestamp: new Date(),
    rawPayload: {},
  } as NormalizedMessage
}

function makeSender() {
  const sent: string[] = []
  return {
    sent,
    sender: {
      enviarTexto: vi.fn(async (_phone: string, text: string) => { sent.push(text) }),
      enviarTemplate: vi.fn(async () => {}),
      enviarImagen: vi.fn(async () => {}),
      enviarDocumento: vi.fn(async () => {}),
    },
  }
}

function makeAdapter(classificationOutput: object): { adapter: ILLMAdapter; callsAt: { content: string; opts: { generationName: string } }[] } {
  const callsAt: { content: string; opts: { generationName: string } }[] = []
  const adapter: ILLMAdapter = {
    async generarTexto(userContent, opciones) {
      callsAt.push({ content: userContent, opts: { generationName: opciones.generationName } })
      if (opciones.generationName?.startsWith('sdr_classifier')) {
        return JSON.stringify(classificationOutput)
      }
      throw new Error(`adapter: unexpected generationName=${opciones.generationName}`)
    },
  }
  return { adapter, callsAt }
}

function makeLlm(): IWasagroLLM {
  return {
    clasificarIntenciones: vi.fn(),
    extraerEventos: vi.fn(),
    corregirTranscripcion: vi.fn(),
    describirImagenVisual: vi.fn(),
    diagnosticarSintomaV2VK: vi.fn(),
    clasificarTipoImagen: vi.fn(),
    extraerDocumentoOCR: vi.fn(),
    onboardarAdmin: vi.fn(),
    onboardarAgricultor: vi.fn(),
    resumirSemana: vi.fn(),
    extraerDatosSDR: vi.fn(async () => ({
      fincas_en_cartera: null,
      cultivo_principal: null,
      pais: null,
      sistema_actual: null,
      es_spam: false,
      pregunta_precio: false,
    })),
    redactarMensajeSDR: vi.fn(async () => {
      throw new Error('redactarMensajeSDR should NOT be called when composer resolves a template')
    }),
    clasificarIntencionSDR: vi.fn(),
    clasificarExcel: vi.fn(),
  } as unknown as IWasagroLLM
}

async function seedPitchSentSession(): Promise<void> {
  const ctx: ConvContext = {
    ...createDefaultContext(PROSPECT_ID, PHONE),
    cultivo: 'cacao',
    pais: 'Ecuador',
    fincasEstimadas: 3,
    segmento: 'agricultor',
    sistemaActual: 'papel',
    fsmState: 'pitch_sent',
    lastBotAction: 'sent_pitch',
    lastBotMessage: 'pitch previo',
    turnCount: 3,
    intentHistory: ['interest'],
    lastObjectionType: null,
    signalStrength: 'warm',
    datosConocidos: 5,
    clarificationTurnsUsed: 0,
  }
  await persistSessionState(ctx)
}

const DIPLOMATIC_APOLOGY = /problemita procesando/i
const AUDIO_ACK_COPY = /vi que mandaste un audio/i
// FIX 1 (R4): interim ack copy sent immediately, before STT+LLM.
const INTERIM_ACK_COPY = /dame un momento y te respondo/i

beforeEach(() => {
  fakeRedis.clear()
  resetClassifierCache()
  vi.clearAllMocks()
  capturedTraceEvents.length = 0
  process.env['DEMO_BOOKING_URL'] = 'https://cal.example/book'
})

describe('SDR audio transcription — successful STT routes through the text pipeline', () => {
  it('transcribes the audio and classifies/extracts/replies from the transcript, not the canned ack', async () => {
    await seedPitchSentSession()
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow())
    vi.mocked(transcribirAudio).mockResolvedValue(TRANSCRIPT)

    const { adapter, callsAt } = makeAdapter({ intent: 'advance', confidence: 0.85, reason: 'transcribed voice note shows readiness' })
    const llm = makeLlm()
    const { sender, sent } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-1', 'trace-stt-1', sender as any, llm, undefined, adapter)

    // FIX 3 (R3): resolveSDRAudioInput never falls back to the raw CDN
    // audioUrl (D8 — that URL always 401s). No Evolution creds are set in
    // this test env, so the download path is unavailable and the resolver
    // yields '' instead of the doomed CDN URL.
    expect(transcribirAudio).toHaveBeenCalledWith('', 'trace-stt-1')

    // FIX 1 (R4): the interim ack was sent first, before the final reply.
    expect(sent[0]).toMatch(INTERIM_ACK_COPY)

    // The classifier (real text pipeline) was invoked WITH the transcript —
    // proof the audio content actually reached the classify->extract->FSM path.
    const classifierCall = callsAt.find(c => c.opts.generationName?.startsWith('sdr_classifier'))
    expect(classifierCall, 'classifier must be invoked with the transcript').toBeDefined()
    expect(classifierCall!.content).toContain(TRANSCRIPT)

    // extraerDatosSDR was called too (text pipeline, not the audio short-circuit).
    expect(llm.extraerDatosSDR).toHaveBeenCalledWith(TRANSCRIPT, expect.anything(), 'trace-stt-1')

    // The canned audioAck-only path was NOT taken.
    const fullConversation = sent.join('\n')
    expect(fullConversation).not.toMatch(AUDIO_ACK_COPY)
    expect(fullConversation).not.toMatch(DIPLOMATIC_APOLOGY)
    // pitch_sent + advance -> closing, deterministic closeOffer template.
    expect(fullConversation).toMatch(/30 minutos/i)

    // The transcript was persisted as the inbound interaction content (not '[audio]').
    const inboundCall = vi.mocked(queries.saveSDRInteraccion).mock.calls.find(
      c => (c[0] as Record<string, unknown>)['tipo'] === 'inbound',
    )
    expect(inboundCall, 'inbound interaction must be saved').toBeDefined()
    expect((inboundCall![0] as Record<string, unknown>)['contenido']).toBe(TRANSCRIPT)
  })

  it('persists the transcript into contenido_raw for the inbound message (best-effort)', async () => {
    await seedPitchSentSession()
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow())
    vi.mocked(transcribirAudio).mockResolvedValue(TRANSCRIPT)

    const { adapter } = makeAdapter({ intent: 'advance', confidence: 0.85 })
    const llm = makeLlm()
    const { sender } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-2', 'trace-stt-2', sender as any, llm, undefined, adapter)

    expect(queries.actualizarMensaje).toHaveBeenCalledWith('mid-stt-2', { contenido_raw: TRANSCRIPT }, undefined)
  })
})

describe('SDR audio transcription — STT failure/empty degrades gracefully', () => {
  it('transcribirAudio throws -> falls back to the canned audioAck, never throws', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery', pais: null, sistema_actual: null }))
    vi.mocked(transcribirAudio).mockRejectedValue(new Error('STT_NO_DISPONIBLE'))

    const llm = makeLlm()
    const { sender, sent } = makeSender()

    await expect(
      handleSDRSession(audioMessage(), 'mid-stt-3', 'trace-stt-3', sender as any, llm),
    ).resolves.toBeUndefined()

    expect(sent.join('\n')).toMatch(AUDIO_ACK_COPY)
    expect(sent.join('\n')).not.toMatch(DIPLOMATIC_APOLOGY)
    // actualizarMensaje IS still called at the end of handleSDRSession
    // (status: 'processed') — the invariant is that it was NEVER called with
    // a contenido_raw update (no transcript to persist on the fallback path).
    const contenidoRawCalls = vi.mocked(queries.actualizarMensaje).mock.calls.filter(
      c => 'contenido_raw' in (c[1] as Record<string, unknown>),
    )
    expect(contenidoRawCalls).toHaveLength(0)
  })

  it('transcribirAudio returns empty string -> falls back to the canned audioAck', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery', pais: null, sistema_actual: null }))
    vi.mocked(transcribirAudio).mockResolvedValue('')

    const llm = makeLlm()
    const { sender, sent } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-4', 'trace-stt-4', sender as any, llm)

    expect(sent.join('\n')).toMatch(AUDIO_ACK_COPY)
    const contenidoRawCalls = vi.mocked(queries.actualizarMensaje).mock.calls.filter(
      c => 'contenido_raw' in (c[1] as Record<string, unknown>),
    )
    expect(contenidoRawCalls).toHaveLength(0)
  })

  // FIX 4 (WARNING): whitespace-only transcript must be treated as empty
  // (the code already .trim()s before checking) and degrade the same way as
  // a truly empty transcript.
  it('transcribirAudio returns a whitespace-only string -> treated as empty, falls back to the canned audioAck', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery', pais: null, sistema_actual: null }))
    vi.mocked(transcribirAudio).mockResolvedValue('   ')

    const llm = makeLlm()
    const { sender, sent } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-9', 'trace-stt-9', sender as any, llm)

    expect(sent.join('\n')).toMatch(AUDIO_ACK_COPY)
    const contenidoRawCalls = vi.mocked(queries.actualizarMensaje).mock.calls.filter(
      c => 'contenido_raw' in (c[1] as Record<string, unknown>),
    )
    expect(contenidoRawCalls).toHaveLength(0)
  })
})

describe('SDR audio transcription — interim ack sent before STT (FIX 1)', () => {
  it('sends the interim ack before attempting transcription, in addition to the eventual reply', async () => {
    await seedPitchSentSession()
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow())

    const { adapter } = makeAdapter({ intent: 'advance', confidence: 0.85 })
    const llm = makeLlm()
    const { sender, sent } = makeSender()

    vi.mocked(transcribirAudio).mockImplementation(async () => {
      // By the time STT is invoked, the interim ack must already be in flight.
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatch(INTERIM_ACK_COPY)
      return TRANSCRIPT
    })

    await handleSDRSession(audioMessage(), 'mid-stt-10', 'trace-stt-10', sender as any, llm, undefined, adapter)

    // The interim ack augments the flow — the real reply still follows.
    expect(sent[0]).toMatch(INTERIM_ACK_COPY)
    expect(sent.length).toBeGreaterThan(1)
  })

  it('sends the interim ack even on the fallback (STT failure) path, in addition to audioAck', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery', pais: null, sistema_actual: null }))
    vi.mocked(transcribirAudio).mockRejectedValue(new Error('STT_NO_DISPONIBLE'))

    const llm = makeLlm()
    const { sender, sent } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-11', 'trace-stt-11', sender as any, llm)

    expect(sent[0]).toMatch(INTERIM_ACK_COPY)
    expect(sent[1]).toMatch(AUDIO_ACK_COPY)
  })
})

describe('SDR audio transcription — sdr_audio_received fires on every audio turn (FIX 2)', () => {
  it('fires on a successful-transcription turn', async () => {
    await seedPitchSentSession()
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow())
    vi.mocked(transcribirAudio).mockResolvedValue(TRANSCRIPT)

    const { adapter } = makeAdapter({ intent: 'advance', confidence: 0.85 })
    const llm = makeLlm()
    const { sender } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-12', 'trace-stt-12', sender as any, llm, undefined, adapter)

    expect(capturedTraceEvents.some(e => e.name === 'sdr_audio_received')).toBe(true)
    // sdr_audio_transcribed is an ADDITIONAL signal on the success path.
    expect(capturedTraceEvents.some(e => e.name === 'sdr_audio_transcribed')).toBe(true)
  })

  it('fires on a fallback (STT failure) turn', async () => {
    seedRedisSession('discovery')
    vi.mocked(queries.getSDRProspecto).mockResolvedValue(prospectoRow({ sdr_node: 'discovery', pais: null, sistema_actual: null }))
    vi.mocked(transcribirAudio).mockRejectedValue(new Error('STT_NO_DISPONIBLE'))

    const llm = makeLlm()
    const { sender } = makeSender()

    await handleSDRSession(audioMessage(), 'mid-stt-13', 'trace-stt-13', sender as any, llm)

    expect(capturedTraceEvents.some(e => e.name === 'sdr_audio_received')).toBe(true)
  })
})
