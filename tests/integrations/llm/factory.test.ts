import { describe, expect, it, afterEach } from 'vitest'
import { crearLLM } from '../../../src/integrations/llm/index.js'
import { GeminiLLM } from '../../../src/integrations/llm/GeminiLLM.js'
import { OllamaLLM } from '../../../src/integrations/llm/OllamaLLM.js'

afterEach(() => {
  delete process.env['WASAGRO_LLM']
  delete process.env['GEMINI_API_KEY']
})

describe('crearLLM', () => {
  it('retorna GeminiLLM con WASAGRO_LLM=gemini', () => {
    process.env['WASAGRO_LLM'] = 'gemini'
    process.env['GEMINI_API_KEY'] = 'test-key'
    expect(crearLLM()).toBeInstanceOf(GeminiLLM)
  })

  it('retorna OllamaLLM con WASAGRO_LLM=ollama', () => {
    process.env['WASAGRO_LLM'] = 'ollama'
    expect(crearLLM()).toBeInstanceOf(OllamaLLM)
  })

  it('lanza error descriptivo con provider inválido', () => {
    process.env['WASAGRO_LLM'] = 'openai'
    expect(() => crearLLM()).toThrow('WASAGRO_LLM="openai" no es válido')
  })

  it('lanza error descriptivo sin WASAGRO_LLM', () => {
    expect(() => crearLLM()).toThrow('no es válido')
  })

  it('lanza error si WASAGRO_LLM=gemini pero falta GEMINI_API_KEY', () => {
    process.env['WASAGRO_LLM'] = 'gemini'
    expect(() => crearLLM()).toThrow('GEMINI_API_KEY')
  })
})
