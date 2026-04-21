import type { IWasagroLLM } from './IWasagroLLM.js'
import { GeminiLLM } from './GeminiLLM.js'
import { OllamaLLM } from './OllamaLLM.js'

export type LLMProvider = 'gemini' | 'ollama'

export function crearLLM(): IWasagroLLM {
  const provider = process.env['WASAGRO_LLM'] as LLMProvider | undefined

  if (provider === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=gemini requiere GEMINI_API_KEY')
    return new GeminiLLM({ apiKey })
  }

  if (provider === 'ollama') {
    return new OllamaLLM()
  }

  throw new Error(
    `WASAGRO_LLM="${provider ?? ''}" no es válido. Valores aceptados: gemini | ollama`
  )
}

export { GeminiLLM, OllamaLLM }
export type { IWasagroLLM }
export { LLMError } from './LLMError.js'
export type { LLMErrorCode } from './LLMError.js'
