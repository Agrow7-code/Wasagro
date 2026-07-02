// Outbound persistence — real-prospect misattribution bug (phone
// 573108059563). sdr_interacciones only ever held the prospect's inbound
// messages (tipo='inbound'/'meeting_confirmation'); the bot's own replies,
// sent via sender.enviarTexto(...), were never persisted with
// tipo='outbound'. That made Wasagro's side of the thread invisible in
// getConversacionThread AND broke the fromMe echo dedup (PR5), which keys
// off an existing 'outbound' row with matching content.
//
// This file covers the two router.ts send sites named in the fix:
//   1. The main qualification-reply path (~line 482).
//   2. The non-MVP cultivo invite branch (~line 240) — persists only the
//      invite bubble, not the separate calendar-link bubble.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Site 1: main qualification-reply path ─────────────────────────────────

const fakeRedisMain = new Map<string, string>()
const langfuseEventsMain: Array<{ name: string; level?: string; input?: unknown }> = []

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeRedisMain.get(k) ?? null),
    set: vi.fn(async () => 'OK'),
  }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
  setIfNotExists: vi.fn(async (k: string, _ttl: number) => {
    if (fakeRedisMain.has(k)) return false
    fakeRedisMain.set(k, '1')
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
    event: (e: any) => langfuseEventsMain.push(e),
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

function makeLlm() {
  return {
    extraerDatosSDR: vi.fn(async () => ({
      fincas_en_cartera: 4, cultivo_principal: 'cacao', pais: 'EC',
      sistema_actual: 'papel', es_spam: false, pregunta_precio: false,
    })),
    redactarMensajeSDR: vi.fn(async () => '¿Cuántas hectáreas manejan actualmente?'),
  }
}

function neutralClassifier(): IIntentClassifier {
  return { classify: vi.fn(async () => ({ intent: 'neutro' as const, confidence: 0.9 })) }
}

beforeEach(() => {
  fakeRedisMain.clear()
  langfuseEventsMain.length = 0
  vi.clearAllMocks()
})

describe('Outbound persistence — main qualification-reply path (router.ts ~line 482)', () => {
  it('persists the bot reply as tipo=outbound with the SAME text that was sent', async () => {
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

    await routeSDRNode(rctx)

    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
    const sentText = sender.enviarTexto.mock.calls[0]![1]

    const outboundCall = vi.mocked(supabaseQueries.saveSDRInteraccion).mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['tipo'] === 'outbound',
    )
    expect(outboundCall).toBeDefined()
    const outboundInsert = outboundCall![0] as Record<string, unknown>
    expect(outboundInsert['contenido']).toBe(sentText)
    expect(outboundInsert['prospecto_id']).toBe('p-1')
    expect(outboundInsert['phone']).toBe(PHONE)
    expect(outboundInsert['action_taken']).toBeNull()
  })

  it('a failure persisting the outbound reply is swallowed (best-effort, does not throw)', async () => {
    vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue(prospectoRow() as any)
    vi.mocked(supabaseQueries.saveSDRInteraccion).mockRejectedValue(new Error('insert boom'))
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

    expect(threw).toBeNull()
    expect(sender.enviarTexto).toHaveBeenCalledTimes(1)
  })
})

// ─── Site 2: non-MVP cultivo invite branch (router.ts ~line 240) ───────────

describe('Outbound persistence — non-MVP cultivo invite branch (router.ts ~line 240)', () => {
  it('persists ONLY the invite bubble as outbound — not the calendar-link bubble', async () => {
    // Reuses the module mocks registered above (shared vi.mock registry per
    // file); getSDRProspecto / saveSDRInteraccion are already vi.fn() spies.
    vi.mocked(supabaseQueries.getSDRProspecto).mockResolvedValue(prospectoRow() as any)
    const sender = makeSender()
    const llm = {
      extraerDatosSDR: vi.fn(async () => ({
        fincas_en_cartera: null, cultivo_principal: 'palma', pais: 'EC',
        sistema_actual: null, es_spam: false, pregunta_precio: false,
      })),
      redactarMensajeSDR: vi.fn(async () => 'redacted LLM response'),
    }
    const rctx: SDRRouterContext = {
      prospecto: prospectoRow(),
      textoOriginal: 'manejo palma africana en 50 hectáreas',
      traceId: 't-1',
      llm: llm as any,
      sender: sender as any,
      classifier: { classify: vi.fn(async () => ({ intent: 'consulta' as const, confidence: 0.9 })) },
    }

    await routeSDRNode(rctx)

    // Two bubbles sent: invite + calendar link.
    expect(sender.enviarTexto).toHaveBeenCalledTimes(2)
    const inviteText = sender.enviarTexto.mock.calls[0]![1]
    const calendarLinkText = sender.enviarTexto.mock.calls[1]![1]

    const outboundCalls = vi.mocked(supabaseQueries.saveSDRInteraccion).mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>)['tipo'] === 'outbound',
    )
    expect(outboundCalls).toHaveLength(1)
    const outboundInsert = outboundCalls[0]![0] as Record<string, unknown>
    expect(outboundInsert['contenido']).toBe(inviteText)
    expect(outboundInsert['contenido']).not.toBe(calendarLinkText)
    expect(outboundInsert['prospecto_id']).toBe('p-1')
    expect(outboundInsert['action_taken']).toBeNull()
  })
})
