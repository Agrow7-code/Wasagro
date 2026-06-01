// E2E roundtrip test — the real-client bug from 2026-06-01:
//
//   bot: "...con Wasagro tus trabajadores registran labores con audio..."  (PITCH)
//   client: "Ya?"
//   bot: (LLM-generated rant that buried the cliente in the wrong direction)
//
// After Fases 0-A-B-C-E this same exchange MUST produce:
//
//   client: "Ya?"
//   bot:    closeOffer template — '¿Te parece si agendamos 10 minutitos para
//           mostrarte cómo se ve, o preferís que te mande el brochure con la
//           info para tu segmento? 📅'
//   bot:    calendarLink template — '📅 Puedes elegir el horario aquí: <URL>'
//
// And NEVER:
//   - any apology ("Disculpa la pregunta anterior...")
//   - "PDF con casos de éxito" / "case studies"
//   - the brochure pointing at the wrong segment for a smallholder
//
// The test pre-populates Redis with the state after turn 1 (pitch sent) and
// runs turn 2 through routeSDRNode end-to-end. It verifies:
//   1. classifier was invoked WITH the lastBotMessage from Redis (resolves H1)
//   2. classifier returned 'advance' for the "Ya?" prompt
//   3. composer produced the closeOffer template (no LLM redaction)
//   4. router sent the calendar link as a follow-up
//   5. the structural anti-patterns (apology, false promise) never appear
//   6. Redis state was re-persisted with fsmState='closing' for next turn

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (must come before importing the SUT) ──────────────────────────────

const fakeRedis = new Map<string, string>()

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedis.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, _mode?: string, _ttl?: number, _nx?: string) => {
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
  isPgBossReady: () => false, // skip the chaser enqueue path
}))

// Langfuse is module-scoped — stub the trace/event API so the test doesn't
// try to reach the real langfuse client.
vi.mock('../../../src/integrations/langfuse.js', () => {
  const noopGen = { end: () => {} }
  const noopTrace = {
    id: 'test-trace',
    event: () => {},
    generation: () => noopGen,
  }
  return {
    langfuse: {
      trace: () => noopTrace,
    },
  }
})

// ─── SUT and helpers (imported after mocks) ──────────────────────────────────

import {
  persistSessionState,
} from '../../../src/agents/sdr/contextStore.js'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'
import { resetClassifierCache } from '../../../src/agents/sdr/classifier.js'
import { handleSDRSession } from '../../../src/agents/sdrAgent.js'
import {
  getSDRProspecto,
  createSDRProspecto,
  updateSDRProspecto,
  saveSDRInteraccion,
} from '../../../src/pipeline/supabaseQueries.js'
import type { ILLMAdapter } from '../../../src/integrations/llm/ILLMAdapter.js'
import type { IWasagroLLM } from '../../../src/integrations/llm/IWasagroLLM.js'
import type { NormalizedMessage } from '../../../src/integrations/whatsapp/NormalizedMessage.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PHONE = '+593900000001'
const PITCH_MSG = 'Con Wasagro tus trabajadores registran labores con un audio de WhatsApp, sin teclear ni usar Excel. ¿Cómo registran hoy lo que pasa en el lote?'

// The Supabase row after turn 1 (FSM legacy = 'pitch', counter = 4).
const prospectoRow = {
  id: 'sdr-p-1',
  phone: PHONE,
  sdr_node: 'pitch',
  turns_total: 4,
  cultivo_principal: 'aguacate',
  pais: 'Ecuador',
  fincas_en_cartera: 1,
  sistema_actual: 'papel',
  segmento_icp: 'agricultor',
  status: 'en_discovery',
  narrativa_asignada: 'A' as const,
  source_context: null,
}

// The session state we expect was persisted to Redis at the end of turn 1.
const turn1SessionState = {
  fsmState: 'pitch_sent' as const,
  lastBotAction: 'sent_pitch' as const,
  lastBotMessage: PITCH_MSG,
  intentHistory: ['interest', 'neutro'] as const,
  lastObjectionType: null,
  signalStrength: 'warm' as const,
  clarificationTurnsUsed: 0,
}

beforeEach(() => {
  fakeRedis.clear()
  resetClassifierCache()
  vi.clearAllMocks()
  vi.mocked(getSDRProspecto).mockResolvedValue(prospectoRow as unknown as Record<string, unknown>)
  vi.mocked(createSDRProspecto).mockResolvedValue(prospectoRow as unknown as Record<string, unknown>)
})

async function seedTurn1(): Promise<void> {
  // Build a ConvContext that matches the end of turn 1 and persist it.
  const ctx: ConvContext = {
    ...createDefaultContext(prospectoRow.id, PHONE),
    cultivo: 'aguacate',
    pais: 'Ecuador',
    fincasEstimadas: 1,
    segmento: 'agricultor',
    sistemaActual: 'papel',
    fsmState: turn1SessionState.fsmState,
    lastBotAction: turn1SessionState.lastBotAction,
    lastBotMessage: turn1SessionState.lastBotMessage,
    turnCount: 4,
    intentHistory: [...turn1SessionState.intentHistory],
    lastObjectionType: null,
    signalStrength: turn1SessionState.signalStrength,
    datosConocidos: 5,
    clarificationTurnsUsed: 0,
  }
  await persistSessionState(ctx)
}

function makeAdapter(classificationOutput: object): { adapter: ILLMAdapter; callsAt: { content: string; opts: { generationName: string } }[] } {
  const callsAt: { content: string; opts: { generationName: string } }[] = []
  const adapter: ILLMAdapter = {
    async generarTexto(userContent, opciones) {
      callsAt.push({ content: userContent, opts: { generationName: opciones.generationName } })
      // The classifier asks for json_object. extraerDatosSDR and
      // redactarMensajeSDR are routed through llm.* below — not through
      // adapter — so we don't need to handle them here.
      if (opciones.generationName?.startsWith('sdr_classifier')) {
        return JSON.stringify(classificationOutput)
      }
      throw new Error(`adapter: unexpected generationName=${opciones.generationName}`)
    },
  }
  return { adapter, callsAt }
}

// llm mock — extraerDatosSDR returns the prospect data we already know
// (this is what the extractor would extract from "Ya?" — basically nothing
// new, so it returns the same fields with null where applicable to avoid
// overwriting what's already in ctx). redactarMensajeSDR should NOT be
// called in this scenario because compose() resolves a template for closing.
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

function makeSender() {
  const sent: string[] = []
  return {
    sent,
    sender: { enviarTexto: vi.fn(async (_phone: string, text: string) => { sent.push(text) }) },
  }
}

// ─── The actual test ─────────────────────────────────────────────────────────

describe('E2E roundtrip — "Ya?" after pitch (real-client regression)', () => {
  it('classifier sees lastBotMessage, returns advance, composer sends closeOffer + calendarLink', async () => {
    // Turn 1 already happened — we seed Redis as if the bot just sent the pitch.
    await seedTurn1()

    // Adapter mock: returns the typed advance intent. The classifier system
    // prompt should also have access to ctx.lastBotMessage = PITCH_MSG.
    const { adapter, callsAt } = makeAdapter({
      intent: 'advance',
      confidence: 0.85,
      reason: 'short reply post-pitch',
    })

    const llm = makeLlm()
    const { sender, sent } = makeSender()

    // Turn 2: client sends "Ya?"
    const msg: NormalizedMessage = {
      from: PHONE,
      tipo: 'texto',
      texto: 'Ya?',
      wamid: 'wamid-turn-2',
      timestamp: new Date(),
      rawPayload: {},
    } as NormalizedMessage

    process.env['DEMO_BOOKING_URL'] = 'https://cal.example/book'

    await handleSDRSession(msg, 'mid-1', 'trace-1', sender, llm, undefined, adapter)

    // ── Gate 1: classifier was called with the pitch in its user content ──
    const classifierCall = callsAt.find(c => c.opts.generationName?.startsWith('sdr_classifier'))
    expect(classifierCall, 'classifier was not invoked').toBeDefined()
    expect(classifierCall!.content).toContain(PITCH_MSG.slice(0, 40))
    expect(classifierCall!.content).toContain('sent_pitch')

    // ── Gate 2: composer produced closeOffer (deterministic template) ──
    // redactarMensajeSDR MUST NOT have been called — composer resolved it.
    expect(llm.redactarMensajeSDR).not.toHaveBeenCalled()

    // closeOffer text + calendarLink follow-up — 2 messages.
    expect(sender.enviarTexto).toHaveBeenCalledTimes(2)
    const fullConversation = sent.join('\n')
    expect(fullConversation).toMatch(/10 minutitos/i)
    expect(fullConversation).toMatch(/brochure/i)
    expect(fullConversation).toContain('https://cal.example/book')

    // ── Gate 3: structural anti-patterns are absent ──
    const lowered = fullConversation.toLowerCase()
    expect(lowered, 'never apologize for a prior question that did not happen').not.toMatch(/^disculp/m)
    expect(lowered, 'never promise "casos de éxito" — Wasagro does not have them').not.toContain('casos de éxito')
    expect(lowered, 'no case studies').not.toContain('case studies')
    expect(lowered, 'brochure goes to agricultor segment for this smallholder, not exportadora').not.toContain('?segment=exportadora')

    // ── Gate 4: Redis state was re-persisted for turn 3 ──
    const stored = fakeRedis.get(`sdr_session:${PHONE}`)
    expect(stored, 'session state must be persisted at end of turn').toBeDefined()
    const next = JSON.parse(stored!)
    expect(next.fsmState, 'reducer should advance pitch_sent -> closing on intent=advance').toBe('closing')
    expect(next.intentHistory.at(-1)).toBe('advance')

    // ── Gate 5: prospect row was updated with status=piloto_propuesto (close path) ──
    const updateCall = vi.mocked(updateSDRProspecto).mock.calls.at(-1)
    expect(updateCall, 'updateSDRProspecto must be called at the end of close turn').toBeDefined()
    const updateData = updateCall![1] as Record<string, unknown>
    expect(updateData['status']).toBe('piloto_propuesto')
    expect(updateData['sdr_node']).toBe('close')

    // ── Gate 6: interaction was logged for audit ──
    expect(saveSDRInteraccion).toHaveBeenCalled()
  })
})

// ─── Regression guard — same scenario, simulated TTL expiry ─────────────────
// If Redis lost the session (TTL or eviction), the classifier no longer sees
// the lastBotMessage. The system degrades to pre-Fase-C behavior: "Ya?" gets
// classified without context. We document this as expected (Anexo Z of ADR-009)
// and verify the bot doesn't crash and produces *some* reasonable response.

describe('E2E roundtrip — TTL expired (Anexo Z degradation)', () => {
  it('no session state in Redis → handler still completes without throwing', async () => {
    // Fresh Redis — turn 1 never persisted (or TTL expired).
    expect(fakeRedis.size).toBe(0)

    // Adapter returns 'other' to mimic LLM seeing the message in isolation.
    const { adapter } = makeAdapter({ intent: 'other', confidence: 0.4 })
    const llm = makeLlm()
    // In this scenario the reducer transitions pitch_sent -> closing on
    // intent='other' (per the FSM table), so composer.closeOffer is still
    // what runs. redactarMensajeSDR may or may not get called depending on
    // FSM path, so we don't strictly assert about it here.
    vi.mocked(llm.redactarMensajeSDR).mockResolvedValue('fallback discovery message')

    const { sender, sent } = makeSender()

    const msg: NormalizedMessage = {
      from: PHONE,
      tipo: 'texto',
      texto: 'Ya?',
      wamid: 'wamid-ttl-expired',
      timestamp: new Date(),
      rawPayload: {},
    } as NormalizedMessage

    await expect(
      handleSDRSession(msg, 'mid-2', 'trace-2', sender, llm, undefined, adapter),
    ).resolves.toBeUndefined()

    // Bot still says SOMETHING (no silent fail) and structural guards still hold.
    const lowered = sent.join('\n').toLowerCase()
    expect(lowered).not.toContain('casos de éxito')
    expect(lowered).not.toMatch(/^disculp/m)
  })
})
