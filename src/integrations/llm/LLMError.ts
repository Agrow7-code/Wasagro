export type LLMErrorCode =
  | 'OLLAMA_UNAVAILABLE'
  | 'GEMINI_ERROR'
  | 'GROQ_ERROR'
  | 'NVIDIA_ERROR'
  | 'PARSE_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'

export class LLMError extends Error {
  readonly code: LLMErrorCode
  readonly cause?: unknown

  constructor(code: LLMErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.cause = cause
  }
}
