import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── In-memory Redis double ──────────────────────────────────────────────────
// Behaves like ioredis for the two methods contextStore uses: get(key) and
// set(key, value, mode, ttl). Stored values are JSON strings (same as prod).
const fakeStore = new Map<string, string>()
const fakeGet = vi.fn(async (key: string) => fakeStore.get(key) ?? null)
const fakeSet = vi.fn(async (key: string, value: string, _mode?: string, _ttl?: number) => {
  fakeStore.set(key, value)
  return 'OK'
})

vi.mock('../../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({ get: fakeGet, set: fakeSet }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
}))

import {
  loadSessionState,
  persistSessionState,
  hydrateContext,
  loadHydratedContext,
  type SessionState,
} from '../../../src/agents/sdr/contextStore.js'
import {
  createDefaultContext,
  reduceContext,
  type ConvContext,
} from '../../../src/agents/sdr/context.js'

const phone = '+593987654321'

beforeEach(() => {
  fakeStore.clear()
  fakeGet.mockClear()
  fakeSet.mockClear()
})

// ─── persistSessionState + loadSessionState round-trip ───────────────────────

describe('persistSessionState + loadSessionState — round-trip', () => {
  it('persists and reloads the same session state', async () => {
    const base = createDefaultContext('p-1', phone)
    const ctx: ConvContext = reduceContext(base, {
      classification: { intent: 'interest', confidence: 0.9 },
      botAction: 'sent_pitch',
      botMessage: 'Acá el pitch completo sobre Wasagro y tus aguacates...',
    })

    await persistSessionState(ctx)
    const loaded = await loadSessionState(phone)

    expect(loaded).not.toBeNull()
    expect(loaded?.fsmState).toBe(ctx.fsmState)
    expect(loaded?.lastBotAction).toBe('sent_pitch')
    expect(loaded?.lastBotMessage).toContain('pitch completo')
    expect(loaded?.intentHistory).toEqual(['interest'])
    expect(loaded?.signalStrength).toBe(ctx.signalStrength)
  })

  it('persists with TTL = 24h (86400s)', async () => {
    const base = createDefaultContext('p-2', phone)
    const ctx = reduceContext(base, { classification: { intent: 'neutro', confidence: 0.5 } })
    await persistSessionState(ctx)
    expect(fakeSet).toHaveBeenCalledWith(
      `sdr_session:${phone}`,
      expect.any(String),
      'EX',
      24 * 3600,
    )
  })

  it('uses sdr_session:<phone> as key', async () => {
    const base = createDefaultContext('p-3', phone)
    await persistSessionState(base)
    expect([...fakeStore.keys()]).toEqual([`sdr_session:${phone}`])
  })

  it('returns null when no session exists', async () => {
    const loaded = await loadSessionState('+593000000000')
    expect(loaded).toBeNull()
  })

  it('returns null for empty phone (no get call)', async () => {
    const loaded = await loadSessionState('')
    expect(loaded).toBeNull()
    expect(fakeGet).not.toHaveBeenCalled()
  })

  it('returns null on corrupt JSON in Redis (graceful)', async () => {
    fakeStore.set(`sdr_session:${phone}`, 'not-json-{{{')
    const loaded = await loadSessionState(phone)
    expect(loaded).toBeNull()
  })

  it('returns null on schema drift (e.g. unknown intent value)', async () => {
    const bogus = {
      fsmState: 'triage',
      lastBotAction: 'none',
      lastBotMessage: null,
      intentHistory: ['some_intent_we_do_not_support_yet'],
      lastObjectionType: null,
      signalStrength: 'unknown',
      clarificationTurnsUsed: 0,
    }
    fakeStore.set(`sdr_session:${phone}`, JSON.stringify(bogus))
    const loaded = await loadSessionState(phone)
    expect(loaded).toBeNull()
  })

  it('skips persist when phone is empty (no crash)', async () => {
    const ctx: ConvContext = { ...createDefaultContext('p-empty', ''), phone: '' }
    await expect(persistSessionState(ctx)).resolves.toBeUndefined()
    expect(fakeSet).not.toHaveBeenCalled()
  })
})

// ─── hydrateContext + sessionState overlay ───────────────────────────────────

describe('hydrateContext — session state overlay on top of prospect row', () => {
  const prospectoRow: Record<string, unknown> = {
    id: 'pid-1',
    phone,
    sdr_node: 'discovery',
    turns_total: 2,
    cultivo_principal: 'cacao',
    pais: 'Ecuador',
    fincas_en_cartera: 3,
    sistema_actual: 'papel',
    segmento_icp: 'agricultor',
    source_context: 'landing',
    status: 'en_discovery',
  }

  it('without sessionState, uses defaults for session-scoped fields', () => {
    const { ctx } = hydrateContext(prospectoRow)
    expect(ctx.intentHistory).toEqual([])
    expect(ctx.lastBotMessage).toBeNull()
    expect(ctx.lastBotAction).toBe('none')
    expect(ctx.signalStrength).toBe('unknown')
    expect(ctx.clarificationTurnsUsed).toBe(0)
  })

  it('with sessionState, overlays intentHistory and lastBotMessage', () => {
    const sessionState: SessionState = {
      fsmState: 'pitch_sent',
      lastBotAction: 'sent_pitch',
      lastBotMessage: 'el pitch que mandó el bot en el turno anterior',
      intentHistory: ['neutro', 'interest', 'advance'],
      lastObjectionType: null,
      signalStrength: 'warm',
      clarificationTurnsUsed: 0,
    }
    const { ctx } = hydrateContext(prospectoRow, sessionState)
    expect(ctx.intentHistory).toEqual(['neutro', 'interest', 'advance'])
    expect(ctx.lastBotMessage).toBe('el pitch que mandó el bot en el turno anterior')
    expect(ctx.lastBotAction).toBe('sent_pitch')
    expect(ctx.signalStrength).toBe('warm')
    // persistent prospect data is preserved
    expect(ctx.cultivo).toBe('cacao')
    expect(ctx.pais).toBe('Ecuador')
  })

  it('sessionState fsmState wins over legacy SDRNode (granular > collapse)', () => {
    // Legacy 'pitch' collapses 'pitch_sent' and 'objection_handling'. Redis stores
    // the granular state, so when we restore it should preserve the distinction.
    const sessionState: SessionState = {
      fsmState: 'brochure_sent',          // not a legacy SDRNode value
      lastBotAction: 'sent_brochure',
      lastBotMessage: 'el brochure',
      intentHistory: ['wants_brochure'],
      lastObjectionType: null,
      signalStrength: 'warm',
      clarificationTurnsUsed: 0,
    }
    const { ctx } = hydrateContext({ ...prospectoRow, sdr_node: 'close' }, sessionState)
    expect(ctx.fsmState).toBe('brochure_sent')
  })
})

// ─── loadHydratedContext — full async path ───────────────────────────────────

describe('loadHydratedContext — full async path used by router.ts', () => {
  const prospectoRow: Record<string, unknown> = {
    id: 'pid-2',
    phone,
    sdr_node: 'pitch',
    turns_total: 4,
    cultivo_principal: 'banano',
    pais: 'Colombia',
    fincas_en_cartera: 2,
    sistema_actual: 'excel',
    segmento_icp: 'agricultor',
  }

  it('on first call (no session yet) hydrates with defaults', async () => {
    const { ctx } = await loadHydratedContext(prospectoRow)
    expect(ctx.intentHistory).toEqual([])
    expect(ctx.lastBotMessage).toBeNull()
    expect(ctx.cultivo).toBe('banano')
  })

  it('after persist + load, intentHistory and lastBotMessage survive', async () => {
    // Turn 1: simulate the router persisting state after sending a pitch
    const turn1Ctx = reduceContext(
      { ...createDefaultContext('pid-2', phone), cultivo: 'banano', segmento: 'agricultor' },
      {
        classification: { intent: 'advance', confidence: 0.9 },
        botAction: 'sent_pitch',
        botMessage: 'Pitch sobre Wasagro y bananos en Colombia...',
      },
    )
    await persistSessionState(turn1Ctx)

    // Turn 2: simulate the router rehydrating from the prospect row + Redis
    const { ctx: turn2Ctx } = await loadHydratedContext(prospectoRow)
    expect(turn2Ctx.intentHistory).toEqual(['advance'])
    expect(turn2Ctx.lastBotMessage).toContain('Pitch sobre Wasagro')
    expect(turn2Ctx.lastBotAction).toBe('sent_pitch')
    // and the persistent prospect facts also survived
    expect(turn2Ctx.cultivo).toBe('banano')
    expect(turn2Ctx.pais).toBe('Colombia')
  })

  it('TTL expiry (simulated by manual clear) degrades to no-history but does not crash', async () => {
    const turn1Ctx = reduceContext(createDefaultContext('pid-2', phone), {
      classification: { intent: 'interest', confidence: 0.9 },
      botAction: 'sent_pitch',
      botMessage: 'pitch',
    })
    await persistSessionState(turn1Ctx)

    // Simulate TTL expiry — Redis would just stop returning the key
    fakeStore.clear()

    const { ctx } = await loadHydratedContext(prospectoRow)
    expect(ctx.intentHistory).toEqual([])
    expect(ctx.lastBotMessage).toBeNull()
    // Persistent prospect row still loads correctly
    expect(ctx.cultivo).toBe('banano')
  })
})
