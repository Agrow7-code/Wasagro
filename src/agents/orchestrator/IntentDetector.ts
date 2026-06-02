import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ILLMAdapter } from '../../integrations/llm/ILLMAdapter.js'
import { runTypedClassifier } from '../../integrations/llm/runTypedClassifier.js'

const TipoEventoEnum = z.enum([
  'labor', 'insumo', 'plaga', 'clima', 'cosecha', 'gasto',
  'calidad', 'venta', 'inventario', 'infraestructura', 'observacion', 'nota_libre',
])
export type TipoEvento = z.infer<typeof TipoEventoEnum>

export const TipoIntentoEnum = z.enum(['nuevo_evento', 'correccion_tipo', 'completar_dato', 'fuera_scope'])
export type TipoIntento = z.infer<typeof TipoIntentoEnum>

export interface DeteccionIntento {
  tipo: TipoIntento
  tipo_forzado?: TipoEvento
  confianza: number
}

const RespuestaLLMSchema = z.object({
  tipo: TipoIntentoEnum,
  tipo_forzado: z.union([TipoEventoEnum, z.null()]),
  confianza: z.number().min(0).max(1),
})
type RespuestaLLM = z.infer<typeof RespuestaLLMSchema>

const FALLBACK_LLM: RespuestaLLM = { tipo: 'nuevo_evento', tipo_forzado: null, confianza: 0 }

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, '../../../prompts/orchestrator/intent-detector.txt'),
  'utf-8',
)

export interface IntentDetectorInput {
  mensaje_usuario: string
  tipo_previo: TipoEvento
  transcripcion_previa: string
}

export class IntentDetector {
  constructor(private readonly adapter: ILLMAdapter) {}

  async detectar(input: IntentDetectorInput, traceId: string): Promise<DeteccionIntento> {
    const userContent = [
      `Tipo de evento previo: ${input.tipo_previo}`,
      `Transcripción previa: ${input.transcripcion_previa}`,
      `Mensaje del usuario: ${input.mensaje_usuario}`,
    ].join('\n')

    const parsed = await runTypedClassifier({
      adapter:        this.adapter,
      systemPrompt:   SYSTEM_PROMPT,
      userContent,
      schema:         RespuestaLLMSchema,
      traceId,
      classifierName: 'event_intent_detector',
      fallback:       FALLBACK_LLM,
      modelClass:     'fast',
      temperature:    0,
      generationInput: input,
    })

    const result: DeteccionIntento = { tipo: parsed.tipo, confianza: parsed.confianza }
    if (parsed.tipo === 'correccion_tipo' && parsed.tipo_forzado) {
      result.tipo_forzado = parsed.tipo_forzado
    }
    return result
  }
}
