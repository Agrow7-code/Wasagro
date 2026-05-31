import { describe, it, expect } from 'vitest'
import {
  ConvContextSchema,
  createDefaultContext,
  reduceContext,
  type ConvContext,
  type IntentClassification,
} from '../../../src/agents/sdr/context.js'

// Helper — builds a classification with sensible defaults
function cls(intent: IntentClassification['intent'], confidence = 0.85): IntentClassification {
  return { intent, confidence }
}

const baseCtx = createDefaultContext('p-1', '+593999999999')

describe('ConvContextSchema', () => {
  it('default context passes schema validation', () => {
    const result = ConvContextSchema.safeParse(baseCtx)
    expect(result.success).toBe(true)
  })

  it('rejects context with invalid fsmState', () => {
    const bad = { ...baseCtx, fsmState: 'inventado' as unknown as ConvContext['fsmState'] }
    expect(ConvContextSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects context with intentHistory longer than 20', () => {
    const bad = { ...baseCtx, intentHistory: new Array(21).fill('neutro') as ConvContext['intentHistory'] }
    expect(ConvContextSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects context with negative turnCount', () => {
    const bad = { ...baseCtx, turnCount: -1 }
    expect(ConvContextSchema.safeParse(bad).success).toBe(false)
  })
})

describe('createDefaultContext', () => {
  it('starts at triage with no data and unknown signal', () => {
    expect(baseCtx.fsmState).toBe('triage')
    expect(baseCtx.turnCount).toBe(0)
    expect(baseCtx.datosConocidos).toBe(0)
    expect(baseCtx.signalStrength).toBe('unknown')
    expect(baseCtx.intentHistory).toEqual([])
    expect(baseCtx.segmento).toBe('desconocido')
    expect(baseCtx.lastBotAction).toBe('none')
    expect(baseCtx.clarificationTurnsUsed).toBe(0)
  })
})

describe('reduceContext — extraction merging', () => {
  it('hydrates cultivo when previously null', () => {
    const next = reduceContext(baseCtx, {
      classification: cls('neutro'),
      extraction: { cultivo: 'aguacate' },
    })
    expect(next.cultivo).toBe('aguacate')
  })

  it('does NOT overwrite a confirmed cultivo even if extraction has a different one', () => {
    const ctx: ConvContext = { ...baseCtx, cultivo: 'aguacate', datosConocidos: 1 }
    const next = reduceContext(ctx, {
      classification: cls('neutro'),
      extraction: { cultivo: 'banano' },
    })
    expect(next.cultivo).toBe('aguacate')
  })

  it('hydrates pais, fincasEstimadas and sistemaActual independently', () => {
    const next = reduceContext(baseCtx, {
      classification: cls('neutro'),
      extraction: { pais: 'Ecuador', fincasEstimadas: 3, sistemaActual: 'papel' },
    })
    expect(next.pais).toBe('Ecuador')
    expect(next.fincasEstimadas).toBe(3)
    expect(next.sistemaActual).toBe('papel')
  })

  it('upgrades segmento from desconocido but never downgrades', () => {
    const ctx: ConvContext = { ...baseCtx, segmento: 'exportadora', datosConocidos: 1 }
    const next = reduceContext(ctx, {
      classification: cls('neutro'),
      extraction: { segmento: 'agricultor' },
    })
    expect(next.segmento).toBe('exportadora')

    const next2 = reduceContext(baseCtx, {
      classification: cls('neutro'),
      extraction: { segmento: 'agricultor' },
    })
    expect(next2.segmento).toBe('agricultor')
  })
})

describe('reduceContext — intentHistory', () => {
  it('appends intent to history', () => {
    const next = reduceContext(baseCtx, { classification: cls('interest') })
    expect(next.intentHistory).toEqual(['interest'])
  })

  it('caps intentHistory at 20 (sliding window)', () => {
    const ctx: ConvContext = {
      ...baseCtx,
      intentHistory: new Array(20).fill('neutro') as ConvContext['intentHistory'],
    }
    const next = reduceContext(ctx, { classification: cls('advance') })
    expect(next.intentHistory.length).toBe(20)
    expect(next.intentHistory[19]).toBe('advance')
    expect(next.intentHistory[0]).toBe('neutro')
  })
})

describe('reduceContext — FSM transitions', () => {
  it('triage advances to discovery on any intent', () => {
    const next = reduceContext(baseCtx, { classification: cls('neutro') })
    expect(next.fsmState).toBe('discovery')
  })

  it('discovery stays in discovery (router handles discovery -> pitch)', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'discovery' }
    const next = reduceContext(ctx, { classification: cls('interest') })
    expect(next.fsmState).toBe('discovery')
  })

  it('pitch_sent + advance -> closing', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'pitch_sent' }
    const next = reduceContext(ctx, { classification: cls('advance') })
    expect(next.fsmState).toBe('closing')
  })

  it('pitch_sent + other -> closing (matches "Ya?" case from ADR-009)', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'pitch_sent' }
    const next = reduceContext(ctx, { classification: cls('other') })
    expect(next.fsmState).toBe('closing')
  })

  it('pitch_sent + objection_price -> objection_handling', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'pitch_sent' }
    const next = reduceContext(ctx, { classification: cls('objection_price') })
    expect(next.fsmState).toBe('objection_handling')
    expect(next.lastObjectionType).toBe('precio')
  })

  it('closing + wants_brochure -> brochure_sent', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'closing' }
    const next = reduceContext(ctx, { classification: cls('wants_brochure') })
    expect(next.fsmState).toBe('brochure_sent')
  })

  it('closing + booked -> meeting_confirmed (terminal-ish)', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'closing' }
    const next = reduceContext(ctx, { classification: cls('booked') })
    expect(next.fsmState).toBe('meeting_confirmed')
  })

  it('any state + declined -> declined', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'pitch_sent' }
    const next = reduceContext(ctx, { classification: cls('declined') })
    expect(next.fsmState).toBe('declined')
  })

  it('dormant + interest -> closing (re-engagement)', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'dormant' }
    const next = reduceContext(ctx, { classification: cls('interest') })
    expect(next.fsmState).toBe('closing')
  })

  it('declined is terminal — stays declined regardless of intent', () => {
    const ctx: ConvContext = { ...baseCtx, fsmState: 'declined' }
    const next = reduceContext(ctx, { classification: cls('interest') })
    expect(next.fsmState).toBe('declined')
  })
})

describe('reduceContext — derived signals', () => {
  it('datosConocidos counts each filled prospect field', () => {
    const ctx: ConvContext = {
      ...baseCtx,
      cultivo: 'cacao',
      pais: 'Ecuador',
      fincasEstimadas: 2,
      segmento: 'agricultor',
      // sistemaActual still null
    }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.datosConocidos).toBe(4)
  })

  it('signalStrength is hot with 3+ hot intents and no cold', () => {
    const ctx: ConvContext = {
      ...baseCtx,
      intentHistory: ['interest', 'advance', 'wants_brochure'],
    }
    const next = reduceContext(ctx, { classification: cls('interest') })
    expect(next.signalStrength).toBe('hot')
  })

  it('signalStrength is cold with 2+ cold intents', () => {
    const ctx: ConvContext = {
      ...baseCtx,
      intentHistory: ['objection_trust', 'declined'],
    }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.signalStrength).toBe('cold')
  })

  it('signalStrength is warm with at least 1 hot signal and no consistent cold', () => {
    const next = reduceContext(baseCtx, { classification: cls('interest') })
    expect(next.signalStrength).toBe('warm')
  })

  it('signalStrength stays unknown with only neutral intents', () => {
    const next = reduceContext(baseCtx, { classification: cls('neutro') })
    expect(next.signalStrength).toBe('unknown')
  })
})

describe('reduceContext — clarification counter (P2)', () => {
  it('increments when previous bot action was ask_question and user gives neutral response', () => {
    const ctx: ConvContext = { ...baseCtx, lastBotAction: 'ask_question' }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.clarificationTurnsUsed).toBe(1)
  })

  it('does NOT increment when previous bot action was not a question', () => {
    const ctx: ConvContext = { ...baseCtx, lastBotAction: 'sent_pitch' }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.clarificationTurnsUsed).toBe(0)
  })

  it('caps at 2 (the P2 invariant) — never goes higher', () => {
    const ctx: ConvContext = {
      ...baseCtx,
      lastBotAction: 'ask_question',
      clarificationTurnsUsed: 2,
    }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.clarificationTurnsUsed).toBe(2)
  })
})

describe('reduceContext — basic invariants', () => {
  it('always increments turnCount by exactly 1', () => {
    const next = reduceContext(baseCtx, { classification: cls('neutro') })
    expect(next.turnCount).toBe(baseCtx.turnCount + 1)
  })

  it('updates lastBotAction only when input provides one', () => {
    const ctx: ConvContext = { ...baseCtx, lastBotAction: 'sent_pitch' }
    const next = reduceContext(ctx, { classification: cls('neutro') })
    expect(next.lastBotAction).toBe('sent_pitch')

    const next2 = reduceContext(ctx, { classification: cls('neutro'), botAction: 'sent_brochure' })
    expect(next2.lastBotAction).toBe('sent_brochure')
  })

  it('updates lastBotMessage when explicitly provided (including null)', () => {
    const ctx: ConvContext = { ...baseCtx, lastBotMessage: 'hola' }
    const next = reduceContext(ctx, {
      classification: cls('neutro'),
      botMessage: 'nuevo mensaje',
    })
    expect(next.lastBotMessage).toBe('nuevo mensaje')

    const next2 = reduceContext(ctx, { classification: cls('neutro'), botMessage: null })
    expect(next2.lastBotMessage).toBeNull()
  })

  it('is pure — same input produces same output (deterministic)', () => {
    const input = {
      classification: cls('advance'),
      extraction: { cultivo: 'banano' as const },
    }
    const a = reduceContext(baseCtx, input)
    const b = reduceContext(baseCtx, input)
    expect(a).toEqual(b)
  })

  it('does NOT mutate the input context (immutable)', () => {
    const snapshot = JSON.parse(JSON.stringify(baseCtx))
    reduceContext(baseCtx, { classification: cls('advance'), extraction: { cultivo: 'cacao' } })
    expect(baseCtx).toEqual(snapshot)
  })

  it('output passes schema validation after any reduction', () => {
    const next = reduceContext(baseCtx, {
      classification: cls('wants_brochure'),
      extraction: { cultivo: 'cafe', pais: 'Colombia', segmento: 'cooperativa' },
      botAction: 'sent_brochure',
      botMessage: 'aqui el brochure',
    })
    expect(ConvContextSchema.safeParse(next).success).toBe(true)
  })
})
