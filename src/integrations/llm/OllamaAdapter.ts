import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'
import { LLMError } from './LLMError.js'
import { langfuse } from '../langfuse.js'

export interface OllamaAdapterConfig {
  baseUrl?: string
  model?: string
  fetchClient?: typeof fetch
}

interface OllamaChatResponse {
  message: { content: string }
}

export class OllamaAdapter implements ILLMAdapter {
  readonly #baseUrl: string
  readonly #model: string
  readonly #fetch: typeof fetch

  constructor(config: OllamaAdapterConfig = {}) {
    this.#baseUrl = config.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
    this.#model = config.model ?? process.env['OLLAMA_MODEL'] ?? 'llama3.2'
    this.#fetch = config.fetchClient ?? globalThis.fetch
  }

  async generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string> {
    const trace = langfuse.trace({ id: opciones.traceId })
    const generation = trace.generation({
      name: opciones.generationName,
      model: this.#model,
      input: opciones.generationInput ?? userContent
    })

    const inicio = Date.now()
    try {
      const contenido = opciones.systemPrompt 
        ? `${opciones.systemPrompt}\n\n${userContent}`
        : userContent

      const res = await this.#fetch(`${this.#baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.#model,
          messages: [{ role: 'user', content: contenido }],
          format: opciones.responseFormat === 'json_object' ? 'json' : undefined,
          stream: false,
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json() as OllamaChatResponse
      const texto = data.message.content
      
      generation.end({ output: texto, metadata: { latencia_ms: Date.now() - inicio } })
      return texto
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      const msg = String(err)
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new LLMError('OLLAMA_UNAVAILABLE', `Ollama no disponible en ${this.#baseUrl} — ¿está corriendo?`, err)
      }
      throw new LLMError('OLLAMA_UNAVAILABLE', `Error en OllamaAdapter: ${msg}`, err)
    }
  }
}
