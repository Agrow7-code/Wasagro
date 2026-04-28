import type { LangfuseTraceClient } from 'langfuse'

export type ModelClass = 'fast' | 'reasoning' | 'ultra'

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
  traceId: string
  generationName: string
  generationInput?: unknown
  modelClass?: ModelClass
  tools?: ToolDef[] // Herramientas disponibles para el modelo (MCP)
}

export interface ILLMAdapter {
  /**
   * Genera texto o devuelve un Tool Call envuelto en JSON usando el LLM subyacente.
   */
  generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string>
}
