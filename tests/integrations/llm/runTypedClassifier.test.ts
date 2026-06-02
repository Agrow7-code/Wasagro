import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { ILLMAdapter, LLMGeneracionOpciones } from '../../../src/integrations/llm/ILLMAdapter.js'
import {
  runTypedClassifier,
  runTypedClassifierWithTelemetry,
} from '../../../src/integrations/llm/runTypedClassifier.js'

// ─── Adapter double ──────────────────────────────────────────────────────────

function makeAdapter(responses: string[]): {
  adapter: ILLMAdapter
  calls: Array<{ userContent: string; opts: LLMGeneracionOpciones }>
} {
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

// ─── Langfuse spy ────────────────────────────────────────────────────────────

function makeLangfuse() {
  const events: Array<{ name: string; level?: string; input?: unknown }> = []
  const generationEnds: Array<{ output?: unknown; metadata?: unknown; level?: string }> = []
  const trace: any = {
    id: 'test-trace',
    event: (e: any) => events.push(e),
    generation: () => ({ end: (g: any) => generationEnds.push(g) }),
  }
  return {
    client: { trace: () => trace } as any,
    events,
    generationEnds,
  }
}

// ─── Sample schema ───────────────────────────────────────────────────────────

const SampleSchema = z.object({
  intent: z.enum(['agendar', 'preguntar', 'salir']),
  confidence: z.number().min(0).max(1),
})
type Sample = z.infer<typeof SampleSchema>

const FALLBACK: Sample = { intent: 'salir', confidence: 0 }

const baseOpts = (adapter: ILLMAdapter, langfuseClient: any) => ({
  adapter,
  systemPrompt: 'Eres un clasificador. Responde JSON.',
  userContent:  'Mensaje: hola',
  schema:       SampleSchema,
  traceId:      't-1',
  classifierName: 'test_classifier',
  fallback:     FALLBACK,
  langfuseClient,
})

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('runTypedClassifier — happy path', () => {
  it('returns parsed data on first attempt', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'agendar', confidence: 0.9 }),
    ])
    const lf = makeLangfuse()

    const result = await runTypedClassifier(baseOpts(adapter, lf.client))

    expect(result).toEqual({ intent: 'agendar', confidence: 0.9 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.opts.generationName).toBe('test_classifier_attempt_1')
    expect(calls[0]?.opts.responseFormat).toBe('json_object')
    expect(calls[0]?.opts.modelClass).toBe('fast')   // default
    expect(calls[0]?.opts.temperature).toBe(0)        // default
  })

  it('strips markdown fences before parsing', async () => {
    const { adapter } = makeAdapter([
      '```json\n{"intent":"preguntar","confidence":0.7}\n```',
    ])
    const lf = makeLangfuse()
    const result = await runTypedClassifier(baseOpts(adapter, lf.client))
    expect(result.intent).toBe('preguntar')
  })

  it('respects custom modelClass + temperature', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'agendar', confidence: 1 }),
    ])
    const lf = makeLangfuse()
    await runTypedClassifier({
      ...baseOpts(adapter, lf.client),
      modelClass: 'reasoning',
      temperature: 0.3,
    })
    expect(calls[0]?.opts.modelClass).toBe('reasoning')
    expect(calls[0]?.opts.temperature).toBe(0.3)
  })

  it('forwards image fields when provided', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'agendar', confidence: 1 }),
    ])
    const lf = makeLangfuse()
    await runTypedClassifier({
      ...baseOpts(adapter, lf.client),
      imageBase64:   'BASE64DATA',
      imageMimeType: 'image/jpeg',
    })
    expect(calls[0]?.opts.imageBase64).toBe('BASE64DATA')
    expect(calls[0]?.opts.imageMimeType).toBe('image/jpeg')
  })
})

// ─── Retry-with-feedback ─────────────────────────────────────────────────────

describe('runTypedClassifier — retry-with-feedback', () => {
  it('first invalid JSON → retry with feedback → recovers', async () => {
    const { adapter, calls } = makeAdapter([
      'this is not json',
      JSON.stringify({ intent: 'agendar', confidence: 0.85 }),
    ])
    const lf = makeLangfuse()

    const result = await runTypedClassifier(baseOpts(adapter, lf.client))

    expect(result.intent).toBe('agendar')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.userContent).toContain('Tu respuesta previa no cumplió el schema')
    expect(calls[1]?.userContent).toContain('was not valid JSON')
    expect(calls[1]?.opts.generationName).toBe('test_classifier_attempt_2_retry')
    // Recovery event was emitted
    expect(lf.events.some(e => e.name === 'test_classifier_retry_recovered')).toBe(true)
  })

  it('first invalid enum → retry → recovers', async () => {
    const { adapter, calls } = makeAdapter([
      JSON.stringify({ intent: 'bogus_intent', confidence: 0.9 }),
      JSON.stringify({ intent: 'preguntar', confidence: 0.7 }),
    ])
    const lf = makeLangfuse()
    const result = await runTypedClassifier(baseOpts(adapter, lf.client))
    expect(result.intent).toBe('preguntar')
    expect(calls[1]?.userContent).toContain('schema validation failed')
  })

  it('both attempts fail → returns fallback + emits warning event', async () => {
    const { adapter } = makeAdapter([
      'first invalid',
      'second invalid',
    ])
    const lf = makeLangfuse()
    const result = await runTypedClassifier(baseOpts(adapter, lf.client))

    expect(result).toEqual(FALLBACK)
    const fallbackEvent = lf.events.find(e => e.name === 'test_classifier_fallback_used')
    expect(fallbackEvent, 'fallback event must be emitted').toBeDefined()
    expect(fallbackEvent?.level).toBe('WARNING')
  })

  it('adapter throws (network error) → returns fallback', async () => {
    const adapter: ILLMAdapter = {
      async generarTexto() {
        throw new Error('network timeout')
      },
    }
    const lf = makeLangfuse()
    const result = await runTypedClassifier(baseOpts(adapter, lf.client))
    expect(result).toEqual(FALLBACK)
    expect(lf.events.find(e => e.name === 'test_classifier_fallback_used')).toBeDefined()
  })
})

// ─── Telemetry surface ───────────────────────────────────────────────────────

describe('runTypedClassifierWithTelemetry', () => {
  it('reports attempts=1 on first success', async () => {
    const { adapter } = makeAdapter([JSON.stringify({ intent: 'agendar', confidence: 1 })])
    const lf = makeLangfuse()
    const { telemetry } = await runTypedClassifierWithTelemetry(baseOpts(adapter, lf.client))
    expect(telemetry).toEqual({ attempts: 1, fallbackUsed: false })
  })

  it('reports attempts=2 + fallbackUsed=false on recovered retry', async () => {
    const { adapter } = makeAdapter([
      'invalid',
      JSON.stringify({ intent: 'agendar', confidence: 1 }),
    ])
    const lf = makeLangfuse()
    const { telemetry } = await runTypedClassifierWithTelemetry(baseOpts(adapter, lf.client))
    expect(telemetry).toEqual({ attempts: 2, fallbackUsed: false })
  })

  it('reports attempts=2 + fallbackUsed=true when both attempts fail', async () => {
    const { adapter } = makeAdapter(['x', 'y'])
    const lf = makeLangfuse()
    const { telemetry } = await runTypedClassifierWithTelemetry(baseOpts(adapter, lf.client))
    expect(telemetry).toEqual({ attempts: 2, fallbackUsed: true })
  })
})
