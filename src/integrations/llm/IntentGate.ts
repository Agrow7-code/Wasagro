import { z } from 'zod'
import type { ILLMAdapter } from './ILLMAdapter.js'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import { PromptManager } from '../../pipeline/promptManager.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'
import type { EntradaEvento, ResultadoIntentGate } from '../../types/dominio/EventoCampo.js'
import { ResultadoIntentGateSchema } from '../../types/dominio/EventoCampo.js'
import { runTypedClassifier } from './runTypedClassifier.js'

// Raw LLM output schema. Required fields are required to avoid Zod's input-vs-
// output type split (z.default makes the generic helper unable to infer T cleanly
// with exactOptionalPropertyTypes). The helper retries once with feedback if
// the LLM forgets a required field — that's the right correction path.
const IntentGateRawSchema = z.object({
  tipos_evento: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  requiere_imagen_para_confirmar: z.boolean().optional(),
  motivo_ambiguo: z.string().nullable().optional(),
  mensaje_clarificacion: z.string().nullable().optional(),
})
type IntentGateRaw = z.infer<typeof IntentGateRawSchema>

// Safe default if both attempts fail — no events detected, ask for clarification.
const RAW_FALLBACK: IntentGateRaw = {
  tipos_evento: [],
  confidence: 0,
  mensaje_clarificacion: '¿Puedes contarme más sobre lo que pasó en la finca?',
}

const NO_EVENTO_TIPOS = new Set(['saludo', 'consulta', 'ambiguo'])

type IntencionRow = ResultadoIntentGate['intenciones'][number]

export class IntentGate {
  readonly #adapter: ILLMAdapter
  readonly #lf: Langfuse

  constructor(adapter: ILLMAdapter, lf?: Langfuse) {
    this.#adapter = adapter
    this.#lf = lf ?? langfuseDefault
  }

  async clasificar(input: EntradaEvento, traceId: string): Promise<ResultadoIntentGate> {
    // Short-circuit when the caller already knows the event type (forced
    // routing from upstream). Skip the LLM entirely.
    if (input.tipos_forzados && input.tipos_forzados.length > 0) {
      return buildForcedResult(input.tipos_forzados)
    }
    if (input.tipo_forzado) {
      return buildForcedResult([input.tipo_forzado])
    }

    const systemPrompt = injectarVariables(
      (await PromptManager.getPrompt('sp-00-clasificador.md', 'prompts/sp-00-clasificador.md', traceId)),
      {
        FINCA_NOMBRE:      input.finca_nombre ?? input.finca_id,
        CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      },
    )

    const userMessage = `Nombre del usuario: ${input.nombre_usuario ?? 'No especificado'}\n\nMensaje: ${input.transcripcion}`

    const raw = await runTypedClassifier({
      adapter:         this.#adapter,
      systemPrompt,
      userContent:     userMessage,
      schema:          IntentGateRawSchema,
      traceId,
      classifierName:  'intent_gate',
      fallback:        RAW_FALLBACK,
      modelClass:      'fast',
      temperature:     0,
      langfuseClient:  this.#lf,
      generationInput: { transcripcion: input.transcripcion },
    })

    return postProcess(raw)
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function buildForcedResult(tipos: readonly string[]): ResultadoIntentGate {
  return {
    intenciones: tipos.map(t => ({
      tipo_evento:    t as IntencionRow['tipo_evento'],
      confidence:     1,
      lote_hint:      null,
      producto_hint:  null,
      monto_hint:     null,
    })),
    es_no_evento: false,
    tipo_no_evento: null,
    confidence_general: 1,
    mensaje_clarificacion: null,
  }
}

function postProcess(raw: IntentGateRaw): ResultadoIntentGate {
  const { tipos_evento, confidence } = raw
  const msgClarif = raw.mensaje_clarificacion ?? null

  const soloNoEventos = tipos_evento.length > 0 && tipos_evento.every(t => NO_EVENTO_TIPOS.has(t))

  if (soloNoEventos) {
    const tipoNoEvento = tipos_evento.includes('saludo')
      ? 'saludo' as const
      : tipos_evento.includes('consulta')
        ? 'consulta' as const
        : 'ambiguo' as const
    const result: ResultadoIntentGate = {
      intenciones: [],
      es_no_evento: true,
      tipo_no_evento: tipoNoEvento,
      confidence_general: confidence,
      mensaje_clarificacion: msgClarif,
    }
    // Defensive validation — the schema also runs at the helper boundary, but
    // post-process can still produce something the outer contract rejects.
    return ResultadoIntentGateSchema.parse(result)
  }

  const intenciones = tipos_evento
    .filter(t => !NO_EVENTO_TIPOS.has(t))
    .map(t => ({
      tipo_evento:   t as IntencionRow['tipo_evento'],
      confidence,
      lote_hint:     null as string | null,
      producto_hint: null as string | null,
      monto_hint:    null as string | null,
    }))

  const result: ResultadoIntentGate = {
    intenciones,
    es_no_evento: false,
    tipo_no_evento: null,
    confidence_general: confidence,
    mensaje_clarificacion: intenciones.length === 0
      ? (msgClarif ?? '¿Puedes contarme más sobre lo que pasó en la finca?')
      : null,
  }
  return ResultadoIntentGateSchema.parse(result)
}
