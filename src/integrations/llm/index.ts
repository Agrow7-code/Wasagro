import type { IWasagroLLM } from './IWasagroLLM.js'
import { GeminiLLM } from './GeminiLLM.js'
import { OllamaLLM } from './OllamaLLM.js'
import { GroqLLM } from './GroqLLM.js'

export type LLMProvider = 'gemini' | 'ollama' | 'groq'

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

  if (provider === 'groq') {
    const apiKey = process.env['GROQ_API_KEY']
    if (!apiKey) throw new Error('WASAGRO_LLM=groq requiere GROQ_API_KEY')
    return new GroqLLM({ apiKey })
  }

  throw new Error(
    `WASAGRO_LLM="${provider ?? ''}" no es válido. Valores aceptados: gemini | ollama | groq`
  )
}

export { GeminiLLM, OllamaLLM, GroqLLM }
export type { IWasagroLLM }
export { LLMError } from './LLMError.js'
export type { LLMErrorCode } from './LLMError.js'
