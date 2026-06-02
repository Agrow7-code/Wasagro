// Generic typed-classifier runner — Fase B ADR-009.
//
// Shared infrastructure for every callsite that asks the LLM for a JSON object
// shaped to a Zod schema. Encapsulates the retry-with-feedback pattern + the
// fallback-with-telemetry policy that the SDR IntentClassifier already
// implemented per-call. Migrating IntentGate, IntentDetector, clasificarExcel,
// and clasificarTipoImagen onto this helper unifies the contract:
//
//   1. attempt 1 — call adapter, JSON.parse, Zod safeParse.
//   2. on parse/schema failure — attempt 2 with the prior error appended to
//      the user prompt ("your previous response failed because X — regenerate").
//   3. on second failure — emit Langfuse event '<name>_fallback_used' with full
//      diagnostic + return the caller-provided fallback. Never silent.
//
// Anti-pattern guards from ADR-009 §6:
//   - No catch silencioso: every fallback ends up in Langfuse.
//   - Single source of truth: schema is the Zod schema the caller passed.
//   - The helper does NOT make flow decisions. It only validates + returns.

import { z } from 'zod'
import type { Langfuse } from 'langfuse'
import type { ILLMAdapter, ModelClass } from './ILLMAdapter.js'
import { langfuse as defaultLangfuse } from '../langfuse.js'

export interface RunTypedOptions<T> {
  adapter: ILLMAdapter
  systemPrompt: string
  userContent: string
  schema: z.ZodType<T>
  traceId: string
  // Used both as the langfuse generation name and as the prefix for the
  // '<classifierName>_fallback_used' event when both attempts fail.
  classifierName: string
  // Returned if both attempts fail. Caller decides the safe default — never
  // null, never undefined; the helper guarantees the typed result.
  fallback: T
  modelClass?: ModelClass
  // Defaults to 0 (deterministic). Classifiers should almost always stay at 0.
  temperature?: number
  imageBase64?: string
  imageMimeType?: string
  // Optional Langfuse client injection for tests.
  langfuseClient?: Langfuse
  // Optional metadata to attach to the generation event for richer dashboards.
  generationInput?: unknown
}

export interface RunTypedTelemetry {
  attempts: number
  fallbackUsed: boolean
}

export interface RunTypedResult<T> {
  data: T
  telemetry: RunTypedTelemetry
}

// Public wrapper that returns just the data — the common case. Use the
// `withTelemetry` variant below when the caller needs to inspect attempts.
export async function runTypedClassifier<T>(opts: RunTypedOptions<T>): Promise<T> {
  const { data } = await runTypedClassifierWithTelemetry(opts)
  return data
}

export async function runTypedClassifierWithTelemetry<T>(opts: RunTypedOptions<T>): Promise<RunTypedResult<T>> {
  const {
    adapter, systemPrompt, userContent, schema, traceId,
    classifierName, fallback, modelClass = 'fast', temperature = 0,
    imageBase64, imageMimeType, langfuseClient,
    generationInput,
  } = opts

  const lf = langfuseClient ?? defaultLangfuse
  const trace = lf.trace({ id: traceId })
  const generation = trace.generation({
    name:  classifierName,
    model: `wasagro-${classifierName}`,
    input: generationInput ?? { userContentPreview: userContent.slice(0, 200) },
  })

  const startedAt = Date.now()

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  let firstErr: Error | null = null
  try {
    const raw = await callAdapter(adapter, userContent, buildCallOpts({
      systemPrompt,
      traceId,
      generationName: `${classifierName}_attempt_1`,
      modelClass,
      temperature,
      imageBase64,
      imageMimeType,
    }))
    const data = parseAndValidate(raw, schema)
    generation.end({
      output:   data,
      metadata: { latencia_ms: Date.now() - startedAt, attempt: 1 },
    })
    return { data, telemetry: { attempts: 1, fallbackUsed: false } }
  } catch (err) {
    firstErr = err instanceof Error ? err : new Error(String(err))
  }

  // ── Attempt 2 — retry with feedback ───────────────────────────────────────
  let secondErr: Error | null = null
  try {
    const feedbackContent =
      userContent +
      '\n\nTu respuesta previa no cumplió el schema esperado.\n' +
      `Razón: ${firstErr.message}\n` +
      'Regenerá EXCLUSIVAMENTE el JSON valido. Sin Markdown, sin texto extra.'
    const raw2 = await callAdapter(adapter, feedbackContent, buildCallOpts({
      systemPrompt,
      traceId,
      generationName: `${classifierName}_attempt_2_retry`,
      modelClass,
      temperature,
      imageBase64,
      imageMimeType,
    }))
    const data = parseAndValidate(raw2, schema)
    trace.event({
      name:  `${classifierName}_retry_recovered`,
      level: 'DEFAULT',
      input: { firstErr: firstErr.message },
    })
    generation.end({
      output:   data,
      metadata: { latencia_ms: Date.now() - startedAt, attempt: 2, recovered: true },
    })
    return { data, telemetry: { attempts: 2, fallbackUsed: false } }
  } catch (err) {
    secondErr = err instanceof Error ? err : new Error(String(err))
  }

  // ── Fallback with full telemetry ──────────────────────────────────────────
  trace.event({
    name:  `${classifierName}_fallback_used`,
    level: 'WARNING',
    input: {
      userContentPreview: userContent.slice(0, 200),
      firstErr:  firstErr.message,
      secondErr: secondErr.message,
    },
  })
  generation.end({
    output:   fallback,
    metadata: { latencia_ms: Date.now() - startedAt, attempt: 2, recovered: false },
    level:    'ERROR',
  })
  return { data: fallback, telemetry: { attempts: 2, fallbackUsed: true } }
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface BuildCallOptsInput {
  systemPrompt: string
  traceId: string
  generationName: string
  modelClass: ModelClass
  temperature: number
  imageBase64?: string | undefined
  imageMimeType?: string | undefined
}

// Constructs the adapter options bag, omitting optional image fields entirely
// when undefined (exactOptionalPropertyTypes requires this — passing
// imageBase64: undefined is not the same as not including the key).
function buildCallOpts(opts: BuildCallOptsInput): Parameters<ILLMAdapter['generarTexto']>[1] {
  const out: Parameters<ILLMAdapter['generarTexto']>[1] = {
    systemPrompt:    opts.systemPrompt,
    responseFormat:  'json_object',
    traceId:         opts.traceId,
    generationName:  opts.generationName,
    modelClass:      opts.modelClass,
    temperature:     opts.temperature,
  }
  if (opts.imageBase64 !== undefined) out.imageBase64 = opts.imageBase64
  if (opts.imageMimeType !== undefined) out.imageMimeType = opts.imageMimeType
  return out
}

async function callAdapter(
  adapter: ILLMAdapter,
  userContent: string,
  opts: Parameters<ILLMAdapter['generarTexto']>[1],
): Promise<string> {
  return adapter.generarTexto(userContent, opts)
}

function parseAndValidate<T>(raw: string, schema: z.ZodType<T>): T {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    throw new Error(`schema validation failed: ${validated.error.message}`)
  }
  return validated.data
}
