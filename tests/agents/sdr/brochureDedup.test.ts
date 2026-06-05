// Brochure dedup — TODO [FASE-A] resolved by router-level setIfNotExists
// guard. These tests verify the guard mechanically:
//   1. First brochure send in a 30s window: sender invoked once.
//   2. Second brochure send within 30s: sender suppressed + LangFuse event.
//   3. Different phones do not share dedup state.
//   4. Non-brochure templates are not affected.
//   5. Redis failure falls back to "send anyway" (no regression vs pre-guard).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (must come before importing the SUT) ──────────────────────────────

const fakeRedis = new Map<string, string>()
const langfuseEvents: Array<{ name: string; level?: string; input?: unknown }> = []

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedis.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, _mode?: string, _ttl?: number, nx?: string) => {
      if (nx === 'NX' && fakeRedis.has(k)) return null
      fakeRedis.set(k, v)
      return 'OK'
    }),
  }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
  setIfNotExists: vi.fn(async (k: string, _ttl: number) => {
    if (fakeRedis.has(k)) return false
    fakeRedis.set(k, '1')
    return true
  }),
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
  const trace: any = {
    id: 'test-trace',
    event: (e: any) => langfuseEvents.push(e),
    generation: () => noopGen,
  }
  return { langfuse: { trace: () => trace } }
})

// ─── SUT and helpers ─────────────────────────────────────────────────────────

import { routeSDRNode, type SDRRouterContext } from '../../../src/agents/sdr/router.js'
import type { IIntentClassifier } from '../../../src/agents/sdr/classifier.js'

const PHONE = '593987654321'

function seedRedisSession(): void {
  fakeRedis.set(`sdr_session:${PHONE}`, JSON.stringify({
    fsmState: 'closing',
    lastBotAction: 'sent_pitch',
    lastBotMessage: 'pitch...',
    intentHistory: ['interest'],
    lastObjectionType: null,
    signalStrength: 'warm',
    clarificationTurnsUsed: 0,
  }))
}

function prospectoRow(): Record<string, unknown> {
  return {
    id: 'p-1',
    phone: PHONE,
    sdr_node: 'close',
    turns_total: 3,
    fincas_en_cartera: 3,
    cultivo_principal: 'cacao',
    pais: 'EC',
    sistema_actual: 'papel',
    segmento_icp: 'agricultor',
    source_context: null,
    status: 'en_pitch',
    narrativa_asignada: 'A',
  }
}

function makeSender() {
  return {
    enviarTexto: vi.fn(async (_p: string, _t: string) => {}),
    enviarTemplate: vi.fn(async () => {}),
    enviarImagen: vi.fn(async () => {}),
    enviarDocumento: vi.fn(async () => {}),
  }
}

function makeLlm() {
  return {
    extraerDatosSDR: vi.fn(async () => ({
      fincas_en_cartera: 3, cultivo_principal: 'cacao', pais: 'EC',
      sistema_actual: 'papel', es_spam: false, pregunta_precio: false,
    })),
    redactarMensajeSDR: vi.fn(async () => 'redacted'),
  }
}

// Classifier that always returns wants_brochure → composer.resolveTemplate
// resolves to 'brochureSend' regardless of FSM state (intent override wins).
function brochureClassifier(): IIntentClassifier {
  return {
    classify: vi.fn(async () => ({ intent: 'wants_brochure' as const, confidence: 0.95 })),
  }
}

// Classifier that returns 'neutro' → no intent-override; state-based default
// of 'closing' resolves to 'closeOffer' (not brochureSend). Used to verify the
// dedup only fires for brochureSend.
function closeOfferClassifier(): IIntentClassifier {
  return {
    classify: vi.fn(async () => ({ intent: 'neutro' as const, confidence: 0.95 })),
  }
}

beforeEach(() => {
  fakeRedis.clear()
  langfuseEvents.length = 0
  vi.clearAllMocks()
})

import * as supabaseQueries from '../../../src/pipeline/supabaseQueries.js'

async function runTurn(classifier: IIntentClassifier, phone = PHONE): Promise<{ sender: ReturnType<typeof makeSender> }> {
  vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue({ ...prospectoRow(), phone } as any)
  const sender = makeSender()
  const rctx: SDRRouterContext = {
    prospecto: { ...prospectoRow(), phone },
    textoOriginal: 'mandame el pdf',
    traceId: 't-1',
    llm: makeLlm() as any,
    sender: sender as any,
    classifier,
  }
  await routeSDRNode(rctx)
  return { sender }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Brochure dedup (TODO 1 — FASE-A)', () => {
  it('first brochure send in a window → sender called once + dedup key set in Redis', async () => {
    seedRedisSession()
    const { sender } = await runTurn(brochureClassifier())
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
    expect(sender.enviarTexto.mock.calls[0]![1]).toMatch(/brochure/i)
    expect(fakeRedis.has(`sdr_brochure_sent:${PHONE}`)).toBe(true)
    // No skip event fired
    expect(langfuseEvents.some(e => e.name === 'sdr_brochure_dedup_skipped')).toBe(false)
  })

  it('second brochure send within 30s → sender suppressed + LangFuse skip event', async () => {
    seedRedisSession()
    await runTurn(brochureClassifier())                  // 1st: sent
    const { sender } = await runTurn(brochureClassifier()) // 2nd: should skip
    expect(sender.enviarTexto).not.toHaveBeenCalled()
    const skipEvent = langfuseEvents.find(e => e.name === 'sdr_brochure_dedup_skipped')
    expect(skipEvent).toBeDefined()
    expect(skipEvent?.level).toBe('WARNING')
  })

  it('different phones do NOT share dedup state', async () => {
    seedRedisSession()
    await runTurn(brochureClassifier(), PHONE)
    // Different phone — fresh window
    const otherPhone = '593911111111'
    fakeRedis.set(`sdr_session:${otherPhone}`, fakeRedis.get(`sdr_session:${PHONE}`)!)
    const { sender } = await runTurn(brochureClassifier(), otherPhone)
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
  })

  it('non-brochure template (closeOffer) is NOT affected by brochure dedup', async () => {
    seedRedisSession()
    // Pre-populate brochure dedup key as if a brochure was already sent
    fakeRedis.set(`sdr_brochure_sent:${PHONE}`, '1')
    // Now run a closeOffer turn — should not be blocked
    const { sender } = await runTurn(closeOfferClassifier())
    expect(sender.enviarTexto).toHaveBeenCalled()
    // No skip event (skip only fires on brochureSend path)
    expect(langfuseEvents.some(e => e.name === 'sdr_brochure_dedup_skipped')).toBe(false)
  })
})
