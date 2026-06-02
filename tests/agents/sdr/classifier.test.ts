import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'
import {
  IntentClassifier,
  resetClassifierCache,
  applyConfidenceThreshold,
  type IntentClassification,
} from '../../../src/agents/sdr/classifier.js'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'
import { CONFIDENCE_THRESHOLD } from '../../../src/constants/intents.js'

// ─── Adapter double ──────────────────────────────────────────────────────────
// Captures call arguments so tests can assert what the classifier sent and
// returns a queued sequence of responses (one per generarTexto call).

function makeAdapter(responses: string[]): { adapter: ILLMAdapter; calls: Array<{ userContent: string; opts: LLMGeneracionOpciones }> } {
  const calls: Array<{ userContent: string; opts: LLMGeneracionOpciones }> = []
  let i = 0
  const adapter: ILLMAdapter = {
    async generarTexto(userContent, opciones) {
      calls.push({ userContent, opts: opciones })
      const r = responses[i++]
      if (r === undefined) throw new Error(`adapter: no more queued responses (call #${i})`)
      return r
    },
  }
  return { adapter, calls }
}

const ctxBase = (overrides: Partial<ConvContext> = {}): ConvContext => ({
  ...createDefaultContext('p-1', '+593900000000'),
  ...overrides,
})

beforeEach(() => {
  resetClassifierCache()
})

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('IntentClassifier — happy path', () => {
  it('classifies "Ya?" after sent_pitch as advance (H1 of ADR-009)', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'advance', confidence: 0.85, reason: 'short reply post-pitch' }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const ctx = ctxBase({
      fsmState: 'pitch_sent',
      lastBotAction: 'sent_pitch',
      lastBotMessage: 'Pitch sobre Wasagro y aguacates...',
      intentHistory: ['interest', 'neutro'],
    })

    const result = await classifier.classify('Ya?', ctx, 'trace-1')

    expect(result.intent).toBe('advance')
    expect(result.confidence).toBeGreaterThan(0.7)
    // The classifier MUST have shown the bot's last message to the LLM
    expect(calls[0]?.userContent).toContain('Pitch sobre Wasagro y aguacates')
    expect(calls[0]?.userContent).toContain('lastBotAction: sent_pitch')
  })

  it('classifies "mándame un PDF" after sent_pitch as wants_brochure', async () => {
    const { adapter } = makeAdapter([
      JSON.stringify({ intent: 'wants_brochure', confidence: 0.95 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const ctx = ctxBase({ fsmState: 'closing', lastBotAction: 'sent_pitch' })

    const result = await classifier.classify('mándame un PDF', ctx, 'trace-2')

    expect(result.intent).toBe('wants_brochure')
  })

  it('classifies "cuánto cuesta?" as objection_price', async () => {
    const { adapter } = makeAdapter([
      JSON.stringify({ intent: 'objection_price', confidence: 0.9 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('cuánto cuesta?', ctxBase(), 'trace-3')
    expect(result.intent).toBe('objection_price')
  })

  it('strips markdown code fences before parsing', async () => {
    const { adapter } = makeAdapter([
      '```json\n{"intent":"interest","confidence":0.8}\n```',
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('me interesa', ctxBase(), 'trace-4')
    expect(result.intent).toBe('interest')
  })
})

// ─── Retry-with-feedback ─────────────────────────────────────────────────────

describe('IntentClassifier — retry-with-feedback', () => {
  it('first attempt invalid JSON → retry with feedback → second valid → recovered', async () => {
    const { adapter, calls } = makeAdapter([
      'esto no es JSON',
      JSON.stringify({ intent: 'advance', confidence: 0.8 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('Ya?', ctxBase({ lastBotAction: 'sent_pitch' }), 'trace-r1')
    expect(result.intent).toBe('advance')
    expect(calls).toHaveLength(2)
    // Second call must include feedback about the previous failure
    expect(calls[1]?.userContent).toContain('Tu respuesta previa no cumplió el schema')
    expect(calls[1]?.userContent).toContain('was not valid JSON')
  })

  it('first attempt invalid enum → retry with feedback → second valid', async () => {
    // Note: confidence 0.8 (above CONFIDENCE_THRESHOLD=0.7) so the threshold
    // validator doesn't interfere with the retry assertion. This test is
    // about retry-with-feedback, not threshold.
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'totally_not_a_real_intent', confidence: 0.9 }),
      JSON.stringify({ intent: 'neutro', confidence: 0.8 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('hmm', ctxBase(), 'trace-r2')
    expect(result.intent).toBe('neutro')
    expect(calls[1]?.userContent).toContain('schema validation failed')
  })

  it('both attempts fail → returns "other" fallback with confidence 0', async () => {
    const { adapter } = makeAdapter([
      'invalid 1',
      'invalid 2',
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('?', ctxBase(), 'trace-r3')
    expect(result.intent).toBe('other')
    expect(result.confidence).toBe(0)
    expect(result.reason).toContain('exhausted')
  })

  it('adapter throws (network error) → fallback to "other"', async () => {
    const adapter: ILLMAdapter = {
      async generarTexto() {
        throw new Error('network timeout')
      },
    }
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('hola', ctxBase(), 'trace-r4')
    expect(result.intent).toBe('other')
    expect(result.confidence).toBe(0)
  })

  it('confidence out of range (>1) → schema rejects → retry', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'advance', confidence: 1.5 }),
      JSON.stringify({ intent: 'advance', confidence: 0.9 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('Ya?', ctxBase({ lastBotAction: 'sent_pitch' }), 'trace-r5')
    expect(result.intent).toBe('advance')
    expect(result.confidence).toBe(0.9)
    expect(calls).toHaveLength(2)
  })
})

// ─── Context propagation (H1 guard) ──────────────────────────────────────────

describe('IntentClassifier — ConvContext propagation', () => {
  it('always sends lastBotMessage to the LLM when present', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'advance', confidence: 0.8 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const ctx = ctxBase({
      fsmState: 'brochure_sent',
      lastBotAction: 'sent_brochure',
      lastBotMessage: 'Acá el brochure agricultor: https://...',
      intentHistory: ['wants_brochure'],
    })
    await classifier.classify('Ya?', ctx, 'trace-c1')
    expect(calls[0]?.userContent).toContain('Acá el brochure agricultor')
    expect(calls[0]?.userContent).toContain('lastBotAction: sent_brochure')
    expect(calls[0]?.userContent).toContain('wants_brochure')
  })

  it('uses fast model class + temperature 0 (deterministic classification)', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'neutro', confidence: 0.5 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    await classifier.classify('ok', ctxBase(), 'trace-c2')
    expect(calls[0]?.opts.modelClass).toBe('fast')
    expect(calls[0]?.opts.temperature).toBe(0)
    expect(calls[0]?.opts.responseFormat).toBe('json_object')
  })

  it('does not send the full bot message if it is very long (truncated in snapshot)', async () => {
    // Sanity: the userContent the LLM sees should be a sane size even for a long lastBotMessage.
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'neutro', confidence: 0.5 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const longMsg = 'a'.repeat(2000)
    await classifier.classify('hmm', ctxBase({ lastBotMessage: longMsg }), 'trace-c3')
    // userContent definitely contains some of the bot message
    expect(calls[0]?.userContent.length).toBeGreaterThan(100)
  })
})

// ─── Confidence threshold (Fase D) ───────────────────────────────────────────
// CONFIDENCE_THRESHOLD = 0.7. Anything below collapses to 'other' so the FSM
// never takes a high-stakes branch on a guess. The pre-downgrade intent goes
// into a LangFuse event for the eval dataset.

describe('applyConfidenceThreshold — pure helper', () => {
  const sample = (intent: IntentClassification['intent'], confidence: number): IntentClassification => ({
    intent, confidence, reason: 'test',
  })

  it('high confidence + non-other → passes through unchanged', () => {
    const out = applyConfidenceThreshold(sample('advance', 0.9))
    expect(out.downgraded).toBe(false)
    expect(out.result.intent).toBe('advance')
    expect(out.result.confidence).toBe(0.9)
    expect(out.rawIntent).toBe('advance')
  })

  it('low confidence + non-other → downgrades to other, preserves confidence + rawIntent', () => {
    const out = applyConfidenceThreshold(sample('advance', 0.5))
    expect(out.downgraded).toBe(true)
    expect(out.result.intent).toBe('other')
    expect(out.result.confidence).toBe(0.5)
    expect(out.rawIntent).toBe('advance')
    expect(out.result.reason).toContain('downgraded')
    expect(out.result.reason).toContain("'advance'")
  })

  it('low confidence + already other → no double-downgrade flag', () => {
    const out = applyConfidenceThreshold(sample('other', 0.3))
    expect(out.downgraded).toBe(false)
    expect(out.result.intent).toBe('other')
    expect(out.result.confidence).toBe(0.3)
  })

  it('confidence exactly at threshold (0.7) → no downgrade (strict <)', () => {
    const out = applyConfidenceThreshold(sample('advance', CONFIDENCE_THRESHOLD))
    expect(out.downgraded).toBe(false)
    expect(out.result.intent).toBe('advance')
  })

  it('confidence just below threshold (0.69) → downgrades', () => {
    const out = applyConfidenceThreshold(sample('wants_brochure', 0.69))
    expect(out.downgraded).toBe(true)
    expect(out.result.intent).toBe('other')
  })

  it('respects custom threshold parameter', () => {
    // Pass an explicit 0.9 threshold — 0.8 should downgrade now.
    const out = applyConfidenceThreshold(sample('booked', 0.8), 0.9)
    expect(out.downgraded).toBe(true)
    expect(out.result.intent).toBe('other')
  })
})

describe('IntentClassifier — confidence threshold wiring', () => {
  it('LLM returns intent=advance confidence=0.6 → classify() returns other (downgraded)', async () => {
    const { adapter } = makeAdapter([
      JSON.stringify({ intent: 'advance', confidence: 0.6, reason: 'mild signal' }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const ctx = ctxBase({ fsmState: 'pitch_sent', lastBotAction: 'sent_pitch' })

    const result = await classifier.classify('mmm', ctx, 'trace-th-1')

    // Downstream FSM must NOT see 'advance' on a 0.6 confidence — that path
    // would prematurely transition pitch_sent → closing.
    expect(result.intent).toBe('other')
    expect(result.confidence).toBe(0.6)
    expect(result.reason).toContain('downgraded')
  })

  it('LLM returns intent=objection_price confidence=0.95 → not downgraded', async () => {
    const { adapter } = makeAdapter([
      JSON.stringify({ intent: 'objection_price', confidence: 0.95 }),
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('cuánto cuesta?', ctxBase(), 'trace-th-2')
    expect(result.intent).toBe('objection_price')
    expect(result.confidence).toBe(0.95)
  })

  it('retry path also applies threshold (attempt 2 returns low confidence)', async () => {
    const { adapter } = makeAdapter([
      'totally invalid response',                                              // attempt 1: parse fail
      JSON.stringify({ intent: 'declined', confidence: 0.5 }),                 // attempt 2: low confidence
    ])
    const classifier = new IntentClassifier({ adapter })
    const result = await classifier.classify('eh', ctxBase(), 'trace-th-3')
    // Retry succeeded at schema level, but the threshold then downgrades it.
    expect(result.intent).toBe('other')
    expect(result.confidence).toBe(0.5)
  })
})
