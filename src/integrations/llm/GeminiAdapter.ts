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
    } else if (opciones.modelClass === 'ultra') {
      activeModel = process.env['GEMINI_ULTRA_MODEL'] ?? 'gemini-1.5-pro' // Modalidad multimodal robusta
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
      
      const parts: any[] = []
      
      // En Gemini, es mejor mezclar el system prompt como la primera parte de la instrucción de usuario en llamadas multimodales o si no se usa SystemInstruction explícito
      if (opciones.systemPrompt) {
        parts.push({ text: `INSTRUCCIONES DEL SISTEMA:\n${opciones.systemPrompt}\n\nMENSAJE DEL USUARIO:\n` })
      }
      
      if (userContent) {
        parts.push({ text: userContent })
      }

      if (opciones.imageUrl) {
        let base64Data = opciones.imageUrl
        let mimeType = 'image/jpeg'
        
        // Si es una URL http(s), descargarla a base64
        if (opciones.imageUrl.startsWith('http')) {
          const res = await fetch(opciones.imageUrl)
          if (!res.ok) throw new Error(`Error descargando imagen: HTTP ${res.status}`)
          const buffer = await res.arrayBuffer()
          base64Data = Buffer.from(buffer).toString('base64')
          mimeType = res.headers.get('content-type') || 'image/jpeg'
        }
        
        parts.push({ inlineData: { mimeType, data: base64Data } })
      }

      const contents = [{ role: 'user', parts }]

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
