import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'
import { LLMError } from './LLMError.js'
import { langfuse } from '../langfuse.js'
import { validateUrlAgainstSSRF, SSRFError } from '../ssrfProtection.js'
import { timedFetch } from '../timedFetch.js'
import { recordLLMCallCost } from './LLMCallCostService.js'

export interface GeminiAdapterConfig {
  apiKey: string
  model?: string
  sdkClient?: InstanceType<typeof GoogleGenerativeAI>
}

export class GeminiAdapter implements ILLMAdapter {
  readonly #sdk: InstanceType<typeof GoogleGenerativeAI>
  // Gemini implementa function-calling nativo (ver `toolsConfig` abajo): es el
  // único adapter tool-capaz del pool. El router enruta las peticiones con tools
  // solo a adapters con esta capacidad.
  readonly supportsTools = true
  // Cuando el caller pasa `model` explícito en el constructor, esa elección
  // GANA sobre el mapeo por tier. Permite tener varios GeminiAdapter en el
  // pool con modelos distintos (ej. gemini-3.1-flash-lite primario,
  // gemini-3-flash secundario) para sobrevivir cuotas por modelo.
  readonly #explicitModel: string | undefined
  readonly #defaultModel: string

  constructor(config: GeminiAdapterConfig) {
    this.#explicitModel = config.model
    this.#defaultModel = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'
    this.#sdk = config.sdkClient ?? new GoogleGenerativeAI(config.apiKey)
  }

  async generarTexto(userContent: string, opciones: LLMGeneracionOpciones): Promise<string> {
    let activeModel: string
    if (this.#explicitModel) {
      activeModel = this.#explicitModel
    } else {
      activeModel = this.#defaultModel
      if (opciones.modelClass === 'fast') {
        activeModel = process.env['GEMINI_FAST_MODEL'] ?? 'gemini-2.5-flash'
      } else if (opciones.modelClass === 'reasoning') {
        activeModel = process.env['GEMINI_PRO_MODEL'] ?? 'gemini-2.5-pro'
      } else if (opciones.modelClass === 'ultra') {
        activeModel = process.env['GEMINI_ULTRA_MODEL'] ?? 'gemini-1.5-pro'
      } else if (opciones.modelClass === 'ocr') {
        activeModel = process.env['GEMINI_OCR_MODEL'] ?? process.env['GEMINI_ULTRA_MODEL'] ?? 'gemini-1.5-pro'
      }
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

      if (opciones.imageBase64) {
        parts.push({ inlineData: { mimeType: opciones.imageMimeType ?? 'image/jpeg', data: opciones.imageBase64 } })
    } else if (opciones.imageUrl) {
      let base64Data: string
      let mimeType = 'image/jpeg'

      await validateUrlAgainstSSRF(opciones.imageUrl)
      const res = await timedFetch(15_000)(opciones.imageUrl, { redirect: 'error' })
        if (!res.ok) throw new Error(`Error descargando imagen: HTTP ${res.status}`)
        const buffer = await res.arrayBuffer()
        base64Data = Buffer.from(buffer).toString('base64')
        mimeType = res.headers.get('content-type') || 'image/jpeg'

        parts.push({ inlineData: { mimeType, data: base64Data } })
      }

      const contents = [{ role: 'user', parts }]

      let toolsConfig: any = undefined
      if (opciones.tools && opciones.tools.length > 0) {
        toolsConfig = [{
          functionDeclarations: opciones.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }]
      }

      // Generar el contenido usando el modelo seleccionado dinámicamente
      const result = await gemini.generateContent({
        contents,
        generationConfig: {
          temperature: opciones.temperature ?? 0.7,
          responseMimeType: opciones.responseFormat === 'json_object' && !toolsConfig ? 'application/json' : 'text/plain'
        },
        tools: toolsConfig
      })
      
      const call = result.response.functionCalls()?.[0]
      if (call) {
        const toolCallJson = JSON.stringify({ __tool_call: { name: call.name, args: call.args } })
        const usage = result.response.usageMetadata
        const promptTokens = usage?.promptTokenCount ?? 0
        const completionTokens = usage?.candidatesTokenCount ?? 0
        const totalTokens = usage?.totalTokenCount ?? (promptTokens + completionTokens)
        generation.end({ output: toolCallJson, usage: { totalTokens, promptTokens, completionTokens }, metadata: { latencia_ms: Date.now() - inicio } })
        recordLLMCallCost({
          orgId: opciones.orgId ?? null,
          fincaId: opciones.fincaId ?? null,
          provider: 'gemini',
          model: activeModel,
          modelClass: opciones.modelClass ?? 'reasoning',
          promptTokens,
          completionTokens,
          totalTokens,
          traceId: opciones.traceId,
          latencyMs: Date.now() - inicio,
        })
        return toolCallJson
      }

      const texto = result.response.text()
      const usage2 = result.response.usageMetadata
      const promptTokens2 = usage2?.promptTokenCount ?? 0
      const completionTokens2 = usage2?.candidatesTokenCount ?? 0
      const totalTokens2 = usage2?.totalTokenCount ?? (promptTokens2 + completionTokens2)
      generation.end({ output: texto, usage: { totalTokens: totalTokens2, promptTokens: promptTokens2, completionTokens: completionTokens2 }, metadata: { latencia_ms: Date.now() - inicio } })
      recordLLMCallCost({
        orgId: opciones.orgId ?? null,
        fincaId: opciones.fincaId ?? null,
        provider: 'gemini',
        model: activeModel,
        modelClass: opciones.modelClass ?? 'reasoning',
        promptTokens: promptTokens2,
        completionTokens: completionTokens2,
        totalTokens: totalTokens2,
        traceId: opciones.traceId,
        latencyMs: Date.now() - inicio,
      })
      return texto
  } catch (err) {
    if (err instanceof SSRFError) {
      generation.end({ output: 'SSRF blocked', level: 'ERROR' })
      throw err
    }
    generation.end({ output: 'LLM_ERROR', level: 'ERROR' })
    throw new LLMError('GEMINI_ERROR', `Error en GeminiAdapter`, err)
    }
  }
}
