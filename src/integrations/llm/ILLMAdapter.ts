import type { LangfuseTraceClient } from 'langfuse'

export type ModelClass = 'fast' | 'reasoning' | 'ultra'

export interface LLMGeneracionOpciones {
  systemPrompt?: string
  temperature?: number
  responseFormat?: 'json_object' | 'text'
  imageUrl?: string
  traceId: string
  generationName: string
  generationInput?: unknown
  modelClass?: ModelClass
}

export interface ILLMAdapter {
  /**
   * Genera texto usando el LLM subyacente y registra la generación en Langfuse.
   */
  generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string>
}
