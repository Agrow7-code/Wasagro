import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'
import { LLMError } from './LLMError.js'
import { langfuse } from '../langfuse.js'

export interface GeminiAdapterConfig {
  apiKey: string
  model?: string
  sdkClient?: InstanceType<typeof GoogleGenerativeAI>
}

export class GeminiAdapter implements ILLMAdapter {
  readonly #sdk: InstanceType<typeof GoogleGenerativeAI>
  readonly #model: string

  constructor(config: GeminiAdapterConfig) {
    this.#model = config.model ?? process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash'
    this.#sdk = config.sdkClient ?? new GoogleGenerativeAI(config.apiKey)
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
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      
      let contents: any[] = []
      if (opciones.systemPrompt) {
        contents.push(opciones.systemPrompt)
      }
      
      if (opciones.imageUrl) {
        contents.push({ inlineData: { mimeType: 'image/jpeg', data: opciones.imageUrl } })
      }
      
      if (userContent) {
        contents.push(userContent)
      }
      
      // Para Gemini que a veces espera strings unidos
      const finalContents = opciones.imageUrl ? contents : contents.join('\n\n')

      const result = await gemini.generateContent(finalContents)
      const texto = result.response.text()
      
      generation.end({ output: texto, usage: { totalTokens: 0 }, metadata: { latencia_ms: Date.now() - inicio } })
      return texto
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error en GeminiAdapter: ${String(err)}`, err)
    }
  }
}
