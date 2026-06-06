// Persist tolerance — real-prospect bug 2026-06-06 root-cause fix.
//
// What happened in prod:
//   1. Prospect "Arroz" → out-of-scope flow → fsmState → 'dormant' →
//      fsmStateToLegacySDRNode → 'global_fallback' → UPDATE rejected by
//      check_sdr_node_values (only allowed triage/discovery/pitch/close).
//   2. Turn 6 closing → updateData.calendar_link_sent_at = ... → PGRST204
//      (column missing because migration 43 not applied in prod).
//   In BOTH cases the UPDATE threw BEFORE the send, the catch in
//   handleSDRSession fired "Disculpá, tuve un problemita", and the prospect
//   stopped replying.
//
// Contract these tests fix:
//   - SEND happens before PERSIST
//   - persist failures (UPDATE / saveSDRInteraccion / persistSessionState) are
//     swallowed, logged to LangFuse as WARNING, and DO NOT propagate
//   - the prospect's reply is delivered even when DB rejects every persist call

import { describe, it, expect, beforeEach, vi } from 'vitest'

const fakeRedis = new Map<string, string>()
const langfuseEvents: Array<{ name: string; level?: string; input?: unknown }> = []

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedis.get(k) ?? null),
    set: vi.fn(async () => 'OK'),
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
  updateSDRProspecto: vi.fn(),
  saveSDRInteraccion: vi.fn(),
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

import { routeSDRNode, type SDRRouterContext } from '../../../src/agents/sdr/router.js'
import type { IIntentClassifier } from '../../../src/agents/sdr/classifier.js'
import * as supabaseQueries from '../../../src/pipeline/supabaseQueries.js'

const PHONE = '593987654321'

function prospectoRow(): Record<string, unknown> {
  return {
    id: 'p-1',
    phone: PHONE,
    sdr_node: 'discovery',
    turns_total: 1,
    fincas_en_cartera: null,
    cultivo_principal: null,
    pais: null,
    sistema_actual: null,
    segmento_icp: 'desconocido',
    source_context: null,
    status: 'new',
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

// MVP cultivo (cacao) so the turn goes through the main flow, not the
// non-MVP cultivo invite branch. Those tests are exercising the persist
// tolerance contract of the main path; the non-MVP branch has its own
// tests in outOfScopeCultivo.test.ts.
function makeLlm() {
  return {
    extraerDatosSDR: vi.fn(async () => ({
      fincas_en_cartera: 4, cultivo_principal: 'cacao', pais: 'EC',
      sistema_actual: 'papel', es_spam: false, pregunta_precio: false,
    })),
    redactarMensajeSDR: vi.fn(async () => 'reply'),
  }
}

function neutralClassifier(): IIntentClassifier {
  return { classify: vi.fn(async () => ({ intent: 'neutro' as const, confidence: 0.9 })) }
}

beforeEach(() => {
  fakeRedis.clear()
  langfuseEvents.length = 0
  vi.clearAllMocks()
})

async function runTurn(): Promise<{ sender: ReturnType<typeof makeSender>; threw: Error | null }> {
  vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue(prospectoRow() as any)
  const sender = makeSender()
  const rctx: SDRRouterContext = {
    prospecto: prospectoRow(),
    textoOriginal: 'tenemos arroz',
    traceId: 't-1',
    llm: makeLlm() as any,
    sender: sender as any,
    classifier: neutralClassifier(),
  }
  let threw: Error | null = null
  try {
    await routeSDRNode(rctx)
  } catch (err) {
    threw = err as Error
  }
  return { sender, threw }
}

describe('Persist tolerance (prod incident 2026-06-06)', () => {
  it('UPDATE failure (CHECK constraint violation) is swallowed → reply still delivered + WARNING event', async () => {
    vi.mocked(supabaseQueries.updateSDRProspecto).mockRejectedValue(
      Object.assign(new Error('new row for relation "sdr_prospectos" violates check constraint "check_sdr_node_values"'), { code: '23514' }),
    )
    vi.mocked(supabaseQueries.saveSDRInteraccion).mockResolvedValue(undefined)

    const { sender, threw } = await runTurn()

    expect(threw).toBeNull()
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)

    const failEvent = langfuseEvents.find(e => e.name === 'sdr_update_failed')
    expect(failEvent).toBeDefined()
    expect(failEvent?.level).toBe('WARNING')
    expect((failEvent?.input as any)?.code).toBe('23514')
  })

  it('UPDATE failure (column missing PGRST204) is swallowed → reply still delivered', async () => {
    vi.mocked(supabaseQueries.updateSDRProspecto).mockRejectedValue(
      Object.assign(new Error("Could not find the 'calendar_link_sent_at' column of 'sdr_prospectos' in the schema cache"), { code: 'PGRST204' }),
    )
    vi.mocked(supabaseQueries.saveSDRInteraccion).mockResolvedValue(undefined)

    const { sender, threw } = await runTurn()

    expect(threw).toBeNull()
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)

    const failEvent = langfuseEvents.find(e => e.name === 'sdr_update_failed')
    expect((failEvent?.input as any)?.code).toBe('PGRST204')
  })

  it('saveSDRInteraccion failure is also swallowed', async () => {
    vi.mocked(supabaseQueries.updateSDRProspecto).mockResolvedValue(undefined)
    vi.mocked(supabaseQueries.saveSDRInteraccion).mockRejectedValue(new Error('insert boom'))

    const { sender, threw } = await runTurn()

    expect(threw).toBeNull()
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)

    const failEvent = langfuseEvents.find(e => e.name === 'sdr_interaccion_save_failed')
    expect(failEvent).toBeDefined()
    expect(failEvent?.level).toBe('WARNING')
  })

  it('SEND failure DOES propagate (recovery is appropriate when the reply itself was never delivered)', async () => {
    vi.mocked(supabaseQueries.updateSDRProspecto).mockResolvedValue(undefined)
    vi.mocked(supabaseQueries.saveSDRInteraccion).mockResolvedValue(undefined)

    const sender = makeSender()
    sender.enviarTexto.mockRejectedValueOnce(new Error('whatsapp 500'))

    vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue(prospectoRow() as any)
    const rctx: SDRRouterContext = {
      prospecto: prospectoRow(),
      textoOriginal: 'tenemos arroz',
      traceId: 't-1',
      llm: makeLlm() as any,
      sender: sender as any,
      classifier: neutralClassifier(),
    }
    let threw: Error | null = null
    try {
      await routeSDRNode(rctx)
    } catch (err) {
      threw = err as Error
    }

    expect(threw).not.toBeNull()
    expect(threw?.message).toMatch(/whatsapp 500/)
  })
})
