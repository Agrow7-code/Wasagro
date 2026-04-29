import type { ILLMAdapter } from './ILLMAdapter.js'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import { PromptManager } from '../../pipeline/promptManager.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'
import { LLMError } from './LLMError.js'
import type { EntradaEvento, ResultadoIntentGate } from '../../types/dominio/EventoCampo.js'
import { ResultadoIntentGateSchema } from '../../types/dominio/EventoCampo.js'

export class IntentGate {
  readonly #adapter: ILLMAdapter
  readonly #lf: Langfuse

  constructor(adapter: ILLMAdapter, lf?: Langfuse) {
    this.#adapter = adapter
    this.#lf = lf ?? langfuseDefault
  }

  async clasificar(input: EntradaEvento, traceId: string): Promise<ResultadoIntentGate> {
    if (input.tipos_forzados && input.tipos_forzados.length > 0) {
      return {
        intenciones: input.tipos_forzados.map(t => ({
          tipo_evento: t as ResultadoIntentGate['intenciones'][number]['tipo_evento'],
          confidence: 1,
          lote_hint: null,
          producto_hint: null,
          monto_hint: null,
        })),
        es_no_evento: false,
        tipo_no_evento: null,
        confidence_general: 1,
        mensaje_clarificacion: null,
      }
    }

    if (input.tipo_forzado) {
      return {
        intenciones: [{
          tipo_evento: input.tipo_forzado as ResultadoIntentGate['intenciones'][number]['tipo_evento'],
          confidence: 1,
          lote_hint: null,
          producto_hint: null,
          monto_hint: null,
        }],
        es_no_evento: false,
        tipo_no_evento: null,
        confidence_general: 1,
        mensaje_clarificacion: null,
      }
    }

    const prompt = injectarVariables(
      (await PromptManager.getPrompt('sp-00-clasificador.md', 'prompts/sp-00-clasificador.md', traceId)),
      {
        FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
        CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
        NOMBRE_USUARIO: input.nombre_usuario ?? '',
        MENSAJE: input.transcripcion,
      },
    )

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'intent_gate_clasificar',
      model: 'wasagro-intent-gate',
      input: { transcripcion: input.transcripcion },
    })

    const inicio = Date.now()
    try {
      const textoRaw = await this.#adapter.generarTexto(input.transcripcion, {
        systemPrompt: prompt,
        responseFormat: 'json_object',
        traceId,
        generationName: 'intent_gate',
        modelClass: 'fast',
        temperature: 0,
      })

      const texto = textoRaw.replace(/```json/g, '').replace(/```/g, '').trim()

      let json: unknown
      try {
        json = JSON.parse(texto)
      } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `IntentGate devolvió no-JSON: ${texto.slice(0, 100)}`)
      }

      const raw = json as Record<string, unknown>
      const tiposRaw = Array.isArray(raw['tipos_evento']) ? raw['tipos_evento'] as string[] : []
      const confidence = typeof raw['confidence'] === 'number' ? raw['confidence'] : 0.5
      const requiereImagen = raw['requiere_imagen_para_confirmar'] === true
      const motivoAmbiguo = typeof raw['motivo_ambiguo'] === 'string' ? raw['motivo_ambiguo'] : null
      const msgClarif = typeof raw['mensaje_clarificacion'] === 'string' ? raw['mensaje_clarificacion'] : null

      const noEventoTipos = new Set(['saludo', 'consulta', 'ambiguo'])
      const soloNoEventos = tiposRaw.length > 0 && tiposRaw.every(t => noEventoTipos.has(t))

      if (soloNoEventos) {
        const tipoNoEvento = tiposRaw.includes('saludo')
          ? 'saludo' as const
          : tiposRaw.includes('consulta')
            ? 'consulta' as const
            : 'ambiguo' as const

        const result: ResultadoIntentGate = {
          intenciones: [],
          es_no_evento: true,
          tipo_no_evento: tipoNoEvento,
          confidence_general: confidence,
          mensaje_clarificacion: msgClarif,
        }

        generation.end({ output: result, metadata: { latencia_ms: Date.now() - inicio } })
        return result
      }

      const intenciones = tiposRaw
        .filter(t => !noEventoTipos.has(t))
        .map(t => ({
          tipo_evento: t as ResultadoIntentGate['intenciones'][number]['tipo_evento'],
          confidence,
          lote_hint: null as string | null,
          producto_hint: null as string | null,
          monto_hint: null as string | null,
        }))

      const result: ResultadoIntentGate = {
        intenciones,
        es_no_evento: false,
        tipo_no_evento: null,
        confidence_general: confidence,
        mensaje_clarificacion: intenciones.length === 0 ? (msgClarif ?? '¿Puedes contarme más sobre lo que pasó en la finca?') : null,
      }

      const parsed = ResultadoIntentGateSchema.safeParse(result)
      if (!parsed.success) {
        generation.end({ output: result, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `IntentGate schema inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data, metadata: { latencia_ms: Date.now() - inicio } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en IntentGate: ${String(err)}`, err)
    }
  }
}
