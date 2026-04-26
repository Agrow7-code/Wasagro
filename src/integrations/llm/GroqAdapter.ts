import OpenAI from 'openai'
import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'
import { LLMError } from './LLMError.js'
import { langfuse } from '../langfuse.js'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

export interface GroqAdapterConfig {
  apiKey: string
  model?: string
  sdkClient?: OpenAI
}

export class GroqAdapter implements ILLMAdapter {
  readonly #client: OpenAI
  readonly #model: string

  constructor(config: GroqAdapterConfig) {
    this.#model = config.model ?? process.env['GROQ_MODEL'] ?? DEFAULT_MODEL
    this.#client = config.sdkClient ?? new OpenAI({ apiKey: config.apiKey, baseURL: GROQ_BASE_URL })
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
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
      if (opciones.systemPrompt) {
        messages.push({ role: 'system', content: opciones.systemPrompt })
      }
      if (userContent) {
        messages.push({ role: 'user', content: userContent })
      }

      const callOptions: any = {
        model: this.#model,
        messages,
        temperature: opciones.temperature ?? (opciones.responseFormat === 'json_object' ? 0.1 : 0.2),
      }
      if (opciones.responseFormat === 'json_object') {
        callOptions.response_format = { type: 'json_object' }
      }

      const res = await this.#client.chat.completions.create(callOptions)
      const texto = res.choices[0]?.message.content ?? ''
      
      generation.end({ output: texto, metadata: { latencia_ms: Date.now() - inicio } })
      return texto
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en GroqAdapter: ${String(err)}`, err)
    }
  }
}
