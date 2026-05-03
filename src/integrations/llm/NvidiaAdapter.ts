import OpenAI from 'openai'
import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'
import { LLMError } from './LLMError.js'
import { langfuse } from '../langfuse.js'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

export interface NvidiaAdapterConfig {
  apiKey: string
  model: string
  extraParams?: Record<string, any>
}

export class NvidiaAdapter implements ILLMAdapter {
  readonly #client: OpenAI
  readonly #model: string
  readonly #extraParams: Record<string, any>

  constructor(config: NvidiaAdapterConfig) {
    this.#model = config.model
    this.#client = new OpenAI({ apiKey: config.apiKey, baseURL: NVIDIA_BASE_URL })
    this.#extraParams = config.extraParams ?? {}
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
      if (userContent || opciones.imageBase64 || opciones.imageUrl) {
        if (opciones.imageBase64 || opciones.imageUrl) {
          const imageUrl = opciones.imageBase64
            ? `data:${opciones.imageMimeType ?? 'image/jpeg'};base64,${opciones.imageBase64}`
            : opciones.imageUrl!
          const content: OpenAI.Chat.ChatCompletionContentPart[] = [
            { type: 'image_url', image_url: { url: imageUrl } },
          ]
          if (userContent) content.push({ type: 'text', text: userContent })
          messages.push({ role: 'user', content })
        } else {
          messages.push({ role: 'user', content: userContent })
        }
      }

      const body: any = {
        model: this.#model,
        messages,
        temperature: opciones.temperature ?? (opciones.responseFormat === 'json_object' ? 0.1 : 0.2),
        ...this.#extraParams
      }

      if (opciones.responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' }
      }

      const res = await this.#client.chat.completions.create(body)
      const texto = res.choices[0]?.message.content ?? ''
      
      generation.end({ output: texto, metadata: { latencia_ms: Date.now() - inicio } })
      return texto
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('NVIDIA_ERROR', `Error en NvidiaAdapter (${this.#model}): ${String(err)}`, err)
    }
  }
}
