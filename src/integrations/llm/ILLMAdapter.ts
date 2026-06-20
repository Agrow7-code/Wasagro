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
  // Excluye del routing los nodos cuyo NOMBRE incluye este substring (case-insensitive).
  // Sirve para pedir una 2ª opinión de un modelo DISTINTO del pool (ej. excluir
  // 'Gemini' → rutea a Minimax/Gemma): el desacuerdo entre modelos diferentes revela
  // incertidumbre que el auto-reporte de un solo modelo esconde.
  excluir?: string
}

export interface ILLMAdapter {
  /**
   * Genera texto o devuelve un Tool Call envuelto en JSON usando el LLM subyacente.
   */
  generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string>

  /**
   * Si el adapter soporta function-calling / tools nativas. El router usa esto
   * para NO enrutar una petición con `tools` a un adapter que las ignoraría en
   * silencio (lo que haría que el modelo respondiera sin poder consultar la DB,
   * arriesgando inventar datos — P1). `undefined`/`false` = no soporta tools.
   */
  readonly supportsTools?: boolean
}
