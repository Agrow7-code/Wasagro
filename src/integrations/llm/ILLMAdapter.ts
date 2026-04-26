import type { LangfuseTraceClient } from 'langfuse'

export interface LLMGeneracionOpciones {
  systemPrompt?: string
  temperature?: number
  responseFormat?: 'json_object' | 'text'
  imageUrl?: string
  traceId: string
  generationName: string
  generationInput?: unknown
}

export interface ILLMAdapter {
  /**
   * Genera texto usando el LLM subyacente y registra la generación en Langfuse.
   */
  generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string>
}
