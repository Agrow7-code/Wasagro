import type { LangfuseTraceClient } from 'langfuse'

export type ModelClass = 'fast' | 'reasoning' | 'ultra' | 'ocr'

export interface ToolDef {
  name: string
  description: string
  parameters: any // JSON Schema object for the tool arguments
}

export interface LLMGeneracionOpciones {
  systemPrompt?: string
  temperature?: number
  responseFormat?: 'json_object' | 'text'
  imageUrl?: string
  imageBase64?: string
  imageMimeType?: string
  traceId: string
  generationName: string
  generationInput?: unknown
  modelClass?: ModelClass
  tools?: ToolDef[]
  orgId?: string
  fincaId?: string
  // Override del timeout del router. Default = 20s (LLMRouter.ADAPTER_TIMEOUT_MS).
  // Subir solo para cargas que legítimamente necesitan más: extractores con
  // schema pesado, prompts densos. Pasar el límite degrada la latencia P3.
  timeoutMs?: number
}

export interface ILLMAdapter {
  /**
   * Genera texto o devuelve un Tool Call envuelto en JSON usando el LLM subyacente.
   */
  generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string>
}
