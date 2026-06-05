// TODO [H1-expansion] resolved — out-of-scope cultivo handling.
//
// 1. isMVPCultivo helper: pure boolean check against MVP_CULTIVOS.
// 2. outOfScopeCultivo template: deterministic copy that honors the cultivo
//    label + invites the prospect to waitlist.
// 3. Router branch: when post-extraction cultivo is non-MVP AND not already
//    notified, fires the template + emits sdr_out_of_scope_cultivo event +
//    transitions to dormant. Dedup via Redis SET NX EX 24h.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isMVPCultivo,
  MVP_CULTIVOS,
  createDefaultContext,
  type Cultivo,
} from '../../../src/agents/sdr/context.js'
import { outOfScopeCultivo } from '../../../src/agents/sdr/skills/templates/out-of-scope-cultivo.js'

// ─── isMVPCultivo helper ────────────────────────────────────────────────────

describe('isMVPCultivo (pure helper)', () => {
  it('returns true for every cultivo in MVP_CULTIVOS', () => {
    for (const c of MVP_CULTIVOS) {
      expect(isMVPCultivo(c)).toBe(true)
    }
  })

  it('returns false for cultivos outside MVP', () => {
    const outOfScope: Cultivo[] = ['aguacate', 'palma', 'arroz', 'maiz', 'otro']
    for (const c of outOfScope) {
      expect(isMVPCultivo(c)).toBe(false)
    }
  })

  it('returns false for null (no cultivo extracted yet)', () => {
    expect(isMVPCultivo(null)).toBe(false)
  })
})

// ─── outOfScopeCultivo template ─────────────────────────────────────────────

describe('outOfScopeCultivo template', () => {
  const ctxFor = (cultivo: Cultivo | null) => ({
    ...createDefaultContext('p-1', '+593900000000'),
    cultivo,
  })

  it('uses the cultivo name when not "otro"', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('aguacate') })
    expect(text).toContain('aguacate')
    expect(text).toMatch(/cacao, banano y café/i)
    expect(text).toMatch(/te anoto/i)
  })

  it('uses "ese cultivo" generic phrasing when cultivo is "otro"', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('otro') })
    expect(text).toContain('ese cultivo')
    expect(text).not.toContain('otro')
  })

  it('falls back to "tu cultivo" when cultivo is null (defensive)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor(null) })
    expect(text).toContain('tu cultivo')
  })

  it('mentions all 3 MVP cultivos in the copy (mantener honestidad)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('palma') })
    expect(text).toMatch(/cacao/i)
    expect(text).toMatch(/banano/i)
    expect(text).toMatch(/café/i)
  })

  it('closes with a question (consistent con endsWithQuestion validator)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('palma') })
    expect(text).toMatch(/\?$/)
  })

  it('does NOT promise features that do not exist (P1)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('aguacate') })
    expect(text.toLowerCase()).not.toContain('casos de éxito')
    expect(text.toLowerCase()).not.toContain('testimonios')
    expect(text.toLowerCase()).not.toMatch(/funciona perfecto para/i)
  })
})

// ─── Router branch integration ──────────────────────────────────────────────

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

import { routeSDRNode, type SDRRouterContext } from '../../../src/agents/sdr/router.js'
import * as supabaseQueries from '../../../src/pipeline/supabaseQueries.js'
import type { IIntentClassifier } from '../../../src/agents/sdr/classifier.js'

const PHONE = '593987654321'

function prospectoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    phone: PHONE,
    sdr_node: 'discovery',
    turns_total: 1,
    fincas_en_cartera: null,
    cultivo_principal: null,
    pais: null,
    sistema_actual: null,
    segmento_icp: 'agricultor',
    source_context: null,
    status: 'en_discovery',
    narrativa_asignada: 'A',
    ...overrides,
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

function makeLlmExtractingCultivo(cultivo: string | null) {
  return {
    extraerDatosSDR: vi.fn(async () => ({
      fincas_en_cartera: null,
      cultivo_principal: cultivo,
      pais: 'EC',
      sistema_actual: null,
      es_spam: false,
      pregunta_precio: false,
    })),
    redactarMensajeSDR: vi.fn(async () => 'redacted LLM response'),
  }
}

const neutralClassifier: IIntentClassifier = {
  classify: vi.fn(async () => ({ intent: 'consulta' as const, confidence: 0.9 })),
}

async function runRouterTurn(cultivoExtracted: string | null, prospectoOverrides: Record<string, unknown> = {}) {
  vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue({ ...prospectoRow(prospectoOverrides) } as any)
  const sender = makeSender()
  const llm = makeLlmExtractingCultivo(cultivoExtracted)
  const rctx: SDRRouterContext = {
    prospecto:     prospectoRow(prospectoOverrides),
    textoOriginal: 'manejo palma africana en 50 hectáreas',
    traceId:       't-1',
    llm:           llm as any,
    sender:        sender as any,
    classifier:    neutralClassifier,
  }
  await routeSDRNode(rctx)
  return { sender, llm }
}

beforeEach(() => {
  fakeRedis.clear()
  langfuseEvents.length = 0
  vi.clearAllMocks()
})

describe('Router branch: out-of-scope cultivo', () => {
  it('fires outOfScopeCultivo template when extraction returns non-MVP cultivo', async () => {
    const { sender, llm } = await runRouterTurn('palma')

    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
    const sent = sender.enviarTexto.mock.calls[0]![1]
    expect(sent).toMatch(/palma/i)
    expect(sent).toMatch(/cacao, banano y café/i)
    // Pre-empts the normal flow: the LLM redaction never ran (short-circuit
    // happens before classify/compose).
    expect(llm.redactarMensajeSDR).not.toHaveBeenCalled()
  })

  it('emits sdr_out_of_scope_cultivo LangFuse event with cultivo + phone', async () => {
    await runRouterTurn('arroz')
    const event = langfuseEvents.find(e => e.name === 'sdr_out_of_scope_cultivo')
    expect(event).toBeDefined()
    expect(event?.level).toBe('WARNING')
    expect(event?.input).toMatchObject({ cultivo: 'arroz', phone: PHONE })
  })

  it('dedup: second turn with same non-MVP cultivo does NOT re-fire template', async () => {
    await runRouterTurn('palma')
    expect(fakeRedis.has(`sdr_out_of_scope_sent:${PHONE}`)).toBe(true)

    // Reset langfuse + sender for the second turn
    langfuseEvents.length = 0
    const { sender } = await runRouterTurn('palma')

    // First send was suppressed (dedup blocked) — the LLM path should take over,
    // OR the conversation is dormant so a different branch fires. The KEY assertion:
    // sdr_out_of_scope_cultivo event must NOT have been emitted a second time.
    expect(langfuseEvents.some(e => e.name === 'sdr_out_of_scope_cultivo')).toBe(false)
  })

  it('does NOT fire for MVP cultivos (cacao, banano, cafe, pina)', async () => {
    for (const cultivo of ['cacao', 'banano', 'cafe', 'pina']) {
      fakeRedis.clear()
      langfuseEvents.length = 0
      await runRouterTurn(cultivo)
      expect(langfuseEvents.some(e => e.name === 'sdr_out_of_scope_cultivo'))
        .toBe(false)
    }
  })

  it('does NOT fire when ctx.cultivo is already MVP and extraction proposes non-MVP (reducer invariant)', async () => {
    // Prospect previously declared cacao (MVP). LLM hallucinates aguacate.
    // The "confirmed wins" invariant means effectiveCultivo stays cacao.
    await runRouterTurn('aguacate', { cultivo_principal: 'cacao' })
    expect(langfuseEvents.some(e => e.name === 'sdr_out_of_scope_cultivo')).toBe(false)
  })

  it('does NOT fire when extraction returns no cultivo at all', async () => {
    await runRouterTurn(null)
    expect(langfuseEvents.some(e => e.name === 'sdr_out_of_scope_cultivo')).toBe(false)
  })

  // Gate explícito por estado FSM. Decision: "pull the rug" mid-funnel es peor
  // que continuar el flujo. Si la deteccion no ocurrio en triage/discovery,
  // dejamos al LLM seguir.
  it('does NOT fire when fsmState is past discovery (pitch_sent or later)', async () => {
    fakeRedis.set(`sdr_session:${PHONE}`, JSON.stringify({
      fsmState: 'pitch_sent',
      lastBotAction: 'sent_pitch',
      lastBotMessage: 'pitch...',
      intentHistory: ['interest'],
      lastObjectionType: null,
      signalStrength: 'warm',
      clarificationTurnsUsed: 0,
    }))
    await runRouterTurn('palma', { sdr_node: 'pitch' })
    expect(langfuseEvents.some(e => e.name === 'sdr_out_of_scope_cultivo')).toBe(false)
  })
})
