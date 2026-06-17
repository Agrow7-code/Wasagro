import { describe, expect, it } from 'vitest'
import { LLMError, clasificarFalloLLM } from '../../../src/integrations/llm/LLMError.js'

describe('clasificarFalloLLM', () => {
  it('rate_limit por código estructurado del LLMError', () => {
    expect(clasificarFalloLLM(new LLMError('RATE_LIMIT', 'cuota agotada'))).toBe('rate_limit')
  })

  it('rate_limit por status 429 en la causa (error del SDK)', () => {
    const sdkErr = Object.assign(new Error('Too Many Requests'), { status: 429 })
    expect(clasificarFalloLLM(new LLMError('NVIDIA_ERROR', 'wrap', sdkErr))).toBe('rate_limit')
  })

  it('server por status 5xx en la causa', () => {
    const sdkErr = Object.assign(new Error('Internal'), { status: 503 })
    expect(clasificarFalloLLM(new LLMError('GEMINI_ERROR', 'wrap', sdkErr))).toBe('server')
  })

  it('rate_limit por 429 en el mensaje (word-boundary), no por substring suelto', () => {
    expect(clasificarFalloLLM(new Error('[429 Too Many Requests] cuota'))).toBe('rate_limit')
  })

  it('timeout por mensaje de timeout del propio router', () => {
    expect(clasificarFalloLLM(new Error('adapter_timeout_45000ms'))).toBe('timeout')
  })

  it('NO clasifica como server un "50" suelto dentro de un número (anti-substring)', () => {
    // El bug viejo: errMsg.includes('50') matcheaba "35000ms", "250 tokens", etc.
    expect(clasificarFalloLLM(new Error('respuesta en 250 tokens, latencia 3500ms'))).toBe('otro')
  })

  it('server por 5xx con word-boundary real', () => {
    expect(clasificarFalloLLM(new Error('HTTP 502 Bad Gateway'))).toBe('server')
  })

  it('otro para un error genérico sin señal transitoria', () => {
    expect(clasificarFalloLLM(new Error('JSON inválido del modelo'))).toBe('otro')
  })
})
