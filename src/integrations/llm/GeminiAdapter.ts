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
    // Selección dinámica del modelo (Enrutamiento PDR/SR H1)
    let activeModel = this.#model
    if (opciones.modelClass === 'fast') {
      activeModel = process.env['GEMINI_FAST_MODEL'] ?? 'gemini-2.5-flash'
    } else if (opciones.modelClass === 'reasoning') {
      activeModel = process.env['GEMINI_PRO_MODEL'] ?? 'gemini-2.5-pro'
    }

    const trace = langfuse.trace({ id: opciones.traceId })
    const generation = trace.generation({
      name: opciones.generationName,
      model: activeModel,
      input: opciones.generationInput ?? userContent
    })

    const inicio = Date.now()
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: activeModel })
      
      const contents: any[] = []
      if (opciones.systemPrompt) {
        contents.push({ role: 'user', parts: [{ text: opciones.systemPrompt }] })
      }
      
      if (opciones.imageUrl) {
        contents.push({ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: opciones.imageUrl } }] })
      }
      
      if (userContent) {
        contents.push({ role: 'user', parts: [{ text: userContent }] })
      }

      // Generar el contenido usando el modelo seleccionado dinámicamente
      const result = await gemini.generateContent({
        contents,
        generationConfig: {
          temperature: opciones.temperature ?? 0.7,
          responseMimeType: opciones.responseFormat === 'json_object' ? 'application/json' : 'text/plain'
        }
      })
      const texto = result.response.text()
      
      generation.end({ output: texto, usage: { totalTokens: 0 }, metadata: { latencia_ms: Date.now() - inicio } })
      return texto
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error en GeminiAdapter: ${String(err)}`, err)
    }
  }
}
