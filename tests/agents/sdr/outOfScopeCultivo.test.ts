// Non-MVP cultivo handling — política CLAUDE.md §Identidad: nunca rechazar.
//
// 1. isMVPCultivo helper: pure boolean check against MVP_CULTIVOS.
// 2. outOfScopeCultivo template: invitación a coordinar (NO rechazo).
// 3. Router branch: cuando un cultivo non-MVP se detecta en triage/discovery,
//    manda el invite + calendar link como dos bubbles, FSM va a
//    meeting_proposed (no dormant), encola booking reminder 24h, dedup TTL 24h.

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

describe('outOfScopeCultivo template (invitación, no rechazo)', () => {
  const ctxFor = (cultivo: Cultivo | null) => ({
    ...createDefaultContext('p-1', '+593900000000'),
    cultivo,
  })

  it('uses the cultivo name when not "otro"', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('aguacate') })
    expect(text).toContain('aguacate')
    expect(text).toMatch(/cacao, banano y café/i)
  })

  it('uses "tu cultivo" generic phrasing when cultivo is "otro"', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('otro') })
    expect(text).toContain('tu cultivo')
    expect(text).not.toContain('otro')
  })

  it('falls back to "tu cultivo" when cultivo is null (defensive)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor(null) })
    expect(text).toContain('tu cultivo')
  })

  it('mentions all 3 MVP cultivos in the copy (honestidad sobre el foco actual)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('palma') })
    expect(text).toMatch(/cacao/i)
    expect(text).toMatch(/banano/i)
    expect(text).toMatch(/café/i)
  })

  it('invites to coordinate a meeting (NOT a rejection)', () => {
    const text = outOfScopeCultivo({ ctx: ctxFor('palma') })
    expect(text.toLowerCase()).toMatch(/coordin(amos|ar)|reuni(ón|on)|20 minutos/i)
    // The copy must NOT use rejection language
    expect(text.toLowerCase()).not.toMatch(/te anoto|aviso apenas|más adelante/i)
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
    // Tampoco prometer timeline de implementación
    expect(text.toLowerCase()).not.toMatch(/en \d+ (semana|mes)/i)
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

const pgBossSend = vi.fn(async () => 'jobid')
vi.mock('../../../src/workers/pgBoss.js', () => ({
  getBoss: () => ({ send: pgBossSend }),
  isPgBossReady: () => true,
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
  pgBossSend.mockClear()
  vi.clearAllMocks()
})

describe('Router branch: non-MVP cultivo invite', () => {
  it('fires outOfScopeCultivo template + calendar link bubble when cultivo is non-MVP', async () => {
    const { sender, llm } = await runRouterTurn('palma')

    // Two bubbles: invite + calendar link
    expect(sender.enviarTexto).toHaveBeenCalledTimes(2)
    const invite = sender.enviarTexto.mock.calls[0]![1]
    expect(invite).toMatch(/palma/i)
    expect(invite).toMatch(/cacao, banano y café/i)
    expect(invite).toMatch(/coordin(amos|ar)/i)

    // The LLM redaction never ran (short-circuit before classify/compose).
    expect(llm.redactarMensajeSDR).not.toHaveBeenCalled()
  })

  it('emits sdr_non_mvp_cultivo_invite LangFuse event with cultivo + phone', async () => {
    await runRouterTurn('arroz')
    const event = langfuseEvents.find(e => e.name === 'sdr_non_mvp_cultivo_invite')
    expect(event).toBeDefined()
    expect(event?.input).toMatchObject({ cultivo: 'arroz', phone: PHONE })
  })

  it('enqueues sdr-chaser booking reminder (24h)', async () => {
    await runRouterTurn('palma')
    expect(pgBossSend).toHaveBeenCalledWith(
      'sdr-chaser',
      expect.objectContaining({ prospecto_id: 'p-1', reminder_type: 'booking' }),
      expect.objectContaining({ startAfter: 24 * 3600 }),
    )
  })

  it('updates prospecto with status piloto_propuesto + calendar_link_sent_at', async () => {
    await runRouterTurn('palma')
    expect(supabaseQueries.updateSDRProspecto).toHaveBeenCalled()
    const updateArgs = vi.mocked(supabaseQueries.updateSDRProspecto).mock.calls[0]!
    const updateData = updateArgs[1] as Record<string, unknown>
    expect(updateData['status']).toBe('piloto_propuesto')
    expect(updateData['calendar_link_sent_at']).toEqual(expect.any(String))
  })

  it('dedup: second turn with same non-MVP cultivo does NOT re-fire invite', async () => {
    await runRouterTurn('palma')
    expect(fakeRedis.has(`sdr_out_of_scope_sent:${PHONE}`)).toBe(true)

    langfuseEvents.length = 0
    const { sender } = await runRouterTurn('palma')

    expect(langfuseEvents.some(e => e.name === 'sdr_non_mvp_cultivo_invite')).toBe(false)
  })

  it('does NOT fire for MVP cultivos (cacao, banano, cafe, pina)', async () => {
    for (const cultivo of ['cacao', 'banano', 'cafe', 'pina']) {
      fakeRedis.clear()
      langfuseEvents.length = 0
      await runRouterTurn(cultivo)
      expect(langfuseEvents.some(e => e.name === 'sdr_non_mvp_cultivo_invite'))
        .toBe(false)
    }
  })

  it('does NOT fire when ctx.cultivo is already MVP and extraction proposes non-MVP (reducer invariant)', async () => {
    // Prospect previously declared cacao (MVP). LLM hallucinates aguacate.
    await runRouterTurn('aguacate', { cultivo_principal: 'cacao' })
    expect(langfuseEvents.some(e => e.name === 'sdr_non_mvp_cultivo_invite')).toBe(false)
  })

  it('does NOT fire when extraction returns no cultivo at all', async () => {
    await runRouterTurn(null)
    expect(langfuseEvents.some(e => e.name === 'sdr_non_mvp_cultivo_invite')).toBe(false)
  })

  // Gate explícito por estado FSM. Decision: cambiar de pista mid-funnel
  // confunde al prospecto. Si la detección no ocurrió en triage/discovery,
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
    expect(langfuseEvents.some(e => e.name === 'sdr_non_mvp_cultivo_invite')).toBe(false)
  })
})
