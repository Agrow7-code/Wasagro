import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ILLMAdapter } from '../../integrations/llm/ILLMAdapter.js'

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

const FALLBACK: DeteccionIntento = { tipo: 'nuevo_evento', confianza: 0 }

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

    try {
      const raw = await this.adapter.generarTexto(userContent, {
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: 'json_object',
        temperature: 0,
        traceId,
        generationName: 'intent-detector',
        generationInput: input,
        modelClass: 'fast', // Forzar modelo rápido para el Router
      })

      const parsed = RespuestaLLMSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return FALLBACK

      const { tipo, tipo_forzado, confianza } = parsed.data
      const result: DeteccionIntento = { tipo, confianza }
      if (tipo === 'correccion_tipo' && tipo_forzado) result.tipo_forzado = tipo_forzado

      return result
    } catch (err) {
      console.error('[IntentDetector] Error detectando intención:', err)
      return FALLBACK
    }
  }
}
