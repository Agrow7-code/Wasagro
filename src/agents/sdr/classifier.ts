// SDR intent classifier — Fase B of ADR-009 refactor.
//
// Replaces the legacy 'clasificarIntencionSDR' call pattern (which received
// the contexto as a free-form string and emitted an untyped option) with a
// real typed component:
//
//   - Input:  message text + ConvContext (with lastBotMessage, intentHistory,
//             fsmState, etc. already hydrated by Commit 3).
//   - Output: { intent: Intent (Zod enum), confidence, reason } validated
//             against ClassifierOutputSchema.
//   - Retry-with-feedback: first parse failure feeds the error back to the
//             LLM ('your previous output failed because X — regenerate').
//             Second failure returns a typed 'other' fallback with telemetry.
//   - Anti-pattern guard:  the classifier never makes flow decisions itself.
//             It returns the typed intent; the FSM/reducer in router.ts owns
//             the branch.

import { z } from 'zod'
import { IntentEnum, CONFIDENCE_THRESHOLD, type Intent } from '../../constants/intents.js'
import type { ConvContext } from './context.js'
import { buildContextoString } from './contextStore.js'
import type { ILLMAdapter } from '../../integrations/llm/ILLMAdapter.js'
import { langfuse } from '../../integrations/langfuse.js'

// ─── Output schema ───────────────────────────────────────────────────────────

export const ClassifierOutputSchema = z.object({
  intent: IntentEnum,
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
})

export type IntentClassification = z.infer<typeof ClassifierOutputSchema>

// ─── Confidence threshold validator (Fase D) ─────────────────────────────────
// Pure helper. The system prompt asks the LLM to prefer 'other' on low
// confidence, but LLMs are unreliable about following meta-rules — we enforce
// the threshold in code so the FSM never takes a high-stakes branch on a
// guess. Pre-downgrade (intent, confidence) is preserved in the return tuple
// so classify() can emit a LangFuse event for the eval dataset.
//
// Threshold is strict-less-than: confidence === 0.7 passes. CONFIDENCE_THRESHOLD
// is the single source of truth, defined in constants/intents.ts.

export interface ThresholdResult {
  result: IntentClassification
  downgraded: boolean
  rawIntent: Intent
}

export function applyConfidenceThreshold(
  classification: IntentClassification,
  threshold: number = CONFIDENCE_THRESHOLD,
): ThresholdResult {
  if (classification.confidence < threshold && classification.intent !== 'other') {
    return {
      result: {
        intent: 'other',
        confidence: classification.confidence,
        reason: `downgraded from '${classification.intent}' (confidence ${classification.confidence} < ${threshold})`,
      },
      downgraded: true,
      rawIntent: classification.intent,
    }
  }
  return { result: classification, downgraded: false, rawIntent: classification.intent }
}

// ─── System prompt (compact, with inline few-shot) ───────────────────────────
// Kept short on purpose — Fase E target is < 200 tokens per prompt. The few-shot
// examples carry most of the semantics; the prose is just rules the model
// can't infer from examples alone.

const SYSTEM_PROMPT = `Eres el clasificador de intenciones del agente SDR de Wasagro.

Tarea: leer el mensaje del prospecto + el contexto (qué dijo el bot antes, intent history) y elegir UNA intent.

Devuelve EXCLUSIVAMENTE este JSON (sin Markdown, sin texto extra):
{"intent": "<una de las opciones>", "confidence": 0.0-1.0, "reason": "<breve>"}

Opciones permitidas — no inventes otras:
- wants_brochure: pide PDF, brochure, info escrita
- booked: acepta una agenda concreta ("dale, mañana 3pm")
- will_book_later: dice que reserva después / pide el link
- advance: muestra interés en avanzar, pregunta de continuación corta tras pitch ("ya?", "ok", "cuéntame más")
- interest: declara interés explícito ("me interesa", "suena bien")
- meeting_waiting: ya agendó o está esperando la reunión — dice que está en la sala, que espera que lo acepten, que ya entró al link, que está listo para la demo
- objection_price: presupuesto, costo, caro
- objection_time: no tiene tiempo
- objection_trust: dudas de confianza
- declined: rechaza claramente
- consulta: pregunta general informativa
- neutro: respuesta corta sin señal clara
- other: ninguna aplica con claridad

Regla crítica: si lastBotAction es sent_pitch o sent_brochure y el mensaje es corto/ambiguo ("ya?", "ok", "y?"), la intent correcta es advance — NO objection. Una respuesta corta tras pitch es prompt de continuación, no rechazo.

Si confidence < 0.7, preferí "other" — la honestidad gana al optimismo.

Ejemplos:

Contexto: lastBotAction=sent_pitch, intentHistory=[neutro,interest]
Mensaje: "Ya?"
{"intent":"advance","confidence":0.85,"reason":"respuesta corta tras pitch = continuación"}

Contexto: lastBotAction=sent_brochure, intentHistory=[interest,wants_brochure]
Mensaje: "Ya?"
{"intent":"advance","confidence":0.85,"reason":"ack tras brochure"}

Contexto: lastBotAction=sent_pitch
Mensaje: "mándame un PDF"
{"intent":"wants_brochure","confidence":0.95}

Contexto: lastBotAction=sent_pitch
Mensaje: "cuánto cuesta?"
{"intent":"objection_price","confidence":0.9}

Contexto: lastBotAction=sent_pitch
Mensaje: "no me interesa, gracias"
{"intent":"declined","confidence":0.95}

Contexto: lastBotAction=ask_question
Mensaje: "mmm no sé"
{"intent":"neutro","confidence":0.6}

Contexto: lastBotAction=sent_calendar_link, fsmState=meeting_proposed
Mensaje: "ya estoy en la reunión esperando que me acepten"
{"intent":"meeting_waiting","confidence":0.95,"reason":"prospecto ya entró a la reunión agendada"}

Contexto: lastBotAction=sent_calendar_link, fsmState=meeting_proposed
Mensaje: "estoy en la sala de espera del link"
{"intent":"meeting_waiting","confidence":0.95,"reason":"prospecto en sala de espera de la demo"}

Contexto: lastBotAction=sent_meeting_confirmation, fsmState=meeting_confirmed
Mensaje: "ya entré a la videollamada"
{"intent":"meeting_waiting","confidence":0.95,"reason":"prospecto ya está en la videollamada"}

Contexto: lastBotAction=sent_calendar_link, fsmState=meeting_proposed
Mensaje: "listo, ya le di entrar al link de la reunión"
{"intent":"meeting_waiting","confidence":0.9,"reason":"prospecto entró al link de la reunión"}

Contexto: fsmState=meeting_confirmed
Mensaje: "estoy esperando en la llamada"
{"intent":"meeting_waiting","confidence":0.9,"reason":"prospecto esperando en la llamada"}`

// ─── The classifier ──────────────────────────────────────────────────────────

export interface IIntentClassifier {
  classify(message: string, ctx: ConvContext, traceId: string): Promise<IntentClassification>
}

export class IntentClassifier implements IIntentClassifier {
  readonly #adapter: ILLMAdapter

  constructor(deps: { adapter: ILLMAdapter }) {
    this.#adapter = deps.adapter
  }

  async classify(message: string, ctx: ConvContext, traceId: string): Promise<IntentClassification> {
    const trace = langfuse.trace({ id: traceId })
    const generation = trace.generation({
      name: 'sdr_intent_classifier',
      model: 'wasagro/orchestrator',
      input: { message, contextSnapshot: this.#snapshotCtx(ctx) },
    })

    const startedAt = Date.now()
    const userContent = this.#buildUserContent(message, ctx)

    // Attempt 1 — cold try
    let firstErr: unknown = null
    try {
      const raw = await this.#adapter.generarTexto(userContent, {
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: 'json_object',
        traceId,
        generationName: 'sdr_classifier_attempt_1',
        modelClass: 'fast',
        temperature: 0,
      })
      const parsed = this.#parseOrThrow(raw)
      const validated = this.#applyThresholdWithTelemetry(parsed, message, ctx, trace)
      generation.end({
        output: validated,
        metadata: { latencia_ms: Date.now() - startedAt, attempt: 1 },
      })
      return validated
    } catch (err) {
      firstErr = err
    }

    // Attempt 2 — retry-with-feedback
    try {
      const feedbackContent =
        userContent +
        '\n\nTu respuesta previa no cumplió el schema esperado.\n' +
        `Razón: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}\n` +
        'Regenerá EXCLUSIVAMENTE el JSON {"intent":"...","confidence":0..1,"reason":"..."}. Sin Markdown.'
      const raw2 = await this.#adapter.generarTexto(feedbackContent, {
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: 'json_object',
        traceId,
        generationName: 'sdr_classifier_attempt_2_retry',
        modelClass: 'fast',
        temperature: 0,
      })
      const parsed2 = this.#parseOrThrow(raw2)
      const validated2 = this.#applyThresholdWithTelemetry(parsed2, message, ctx, trace)
      trace.event({
        name: 'sdr_classifier_retry_recovered',
        level: 'DEFAULT',
        input: { firstErr: String(firstErr) },
      })
      generation.end({
        output: validated2,
        metadata: { latencia_ms: Date.now() - startedAt, attempt: 2, recovered: true },
      })
      return validated2
    } catch (secondErr) {
      // Fallback with full telemetry
      const fallback: IntentClassification = { intent: 'other', confidence: 0, reason: 'classifier exhausted retries' }
      trace.event({
        name: 'sdr_classifier_fallback_used',
        level: 'WARNING',
        input: {
          message: message.slice(0, 200),
          ctxSnapshot: this.#snapshotCtx(ctx),
          firstErr: String(firstErr),
          secondErr: String(secondErr),
        },
      })
      generation.end({
        output: fallback,
        metadata: { latencia_ms: Date.now() - startedAt, attempt: 2, recovered: false },
        level: 'ERROR',
      })
      return fallback
    }
  }

  #buildUserContent(message: string, ctx: ConvContext): string {
    const contextoActual = buildContextoString(ctx)
    return [
      'Contexto actual de la conversación:',
      contextoActual,
      `fsmState: ${ctx.fsmState}`,
      `lastBotAction: ${ctx.lastBotAction}`,
      '',
      `Mensaje del prospecto a clasificar: "${message}"`,
    ].join('\n')
  }

  // Applies the confidence threshold and emits a LangFuse event on downgrade so
  // the low-confidence cases land in the eval dataset (Fase D — telemetry of
  // borderline classifications is what feeds the threshold-tuning work later).
  #applyThresholdWithTelemetry(
    parsed: IntentClassification,
    message: string,
    ctx: ConvContext,
    trace: ReturnType<typeof langfuse.trace>,
  ): IntentClassification {
    const { result, downgraded, rawIntent } = applyConfidenceThreshold(parsed)
    if (downgraded) {
      trace.event({
        name:  'sdr_classifier_low_confidence_downgrade',
        level: 'DEFAULT',
        input: {
          rawIntent,
          confidence: parsed.confidence,
          threshold: CONFIDENCE_THRESHOLD,
          message:   message.slice(0, 200),
          ctxSnapshot: this.#snapshotCtx(ctx),
        },
      })
    }
    return result
  }

  #parseOrThrow(raw: string): IntentClassification {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      throw new Error(`response was not valid JSON: ${String(e)}`)
    }
    const validated = ClassifierOutputSchema.safeParse(parsed)
    if (!validated.success) {
      throw new Error(`schema validation failed: ${validated.error.message}`)
    }
    return validated.data
  }

  #snapshotCtx(ctx: ConvContext): Record<string, unknown> {
    return {
      fsmState: ctx.fsmState,
      lastBotAction: ctx.lastBotAction,
      lastBotMessage: ctx.lastBotMessage?.slice(0, 80) ?? null,
      intentHistory: ctx.intentHistory,
      signalStrength: ctx.signalStrength,
      datosConocidos: ctx.datosConocidos,
    }
  }
}

// ─── Module-level singleton for router.ts and sdrAgent.ts to share ───────────
// router.ts and sdrAgent.ts both need a classifier; cache one per adapter so
// we don't recreate it per turn. The adapter identity is the cache key — if
// the test swaps the adapter, the cache invalidates.

let cachedAdapter: ILLMAdapter | null = null
let cachedClassifier: IntentClassifier | null = null

export function getClassifier(adapter: ILLMAdapter): IntentClassifier {
  if (cachedClassifier && cachedAdapter === adapter) return cachedClassifier
  cachedAdapter = adapter
  cachedClassifier = new IntentClassifier({ adapter })
  return cachedClassifier
}

// Reset the singleton — for tests that swap adapter mocks between cases.
export function resetClassifierCache(): void {
  cachedAdapter = null
  cachedClassifier = null
}
