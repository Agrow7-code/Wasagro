import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import type { IWasagroLLM } from './IWasagroLLM.js'
import { LLMError } from './LLMError.js'
import { EventoCampoExtraidoSchema, type EntradaEvento, type EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, ContextoOnboardingAgricultor, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ContextoProspecto, RespuestaProspecto } from '../../types/dominio/Prospecto.js'
import type { ResumenSemanal, EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'

interface GeminiLLMConfig {
  apiKey: string
  model?: string
  sdkClient?: InstanceType<typeof GoogleGenerativeAI>
  langfuseClient?: Langfuse
}

export class GeminiLLM implements IWasagroLLM {
  readonly #model: string
  readonly #sdk: InstanceType<typeof GoogleGenerativeAI>
  readonly #lf: Langfuse

  constructor(config: GeminiLLMConfig) {
    this.#model = config.model ?? process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash'
    this.#sdk = config.sdkClient ?? new GoogleGenerativeAI(config.apiKey)
    this.#lf = config.langfuseClient ?? langfuseDefault
  }

  async extraerEvento(input: EntradaEvento, traceId: string): Promise<EventoCampoExtraido> {
    const prompt = injectarVariables(cargarPrompt('sp-01-extraccion-evento.md'), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados',
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
    })
    const mensajeCompleto = `${prompt}\n\nTranscripción: ${input.transcripcion}`

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'extraer_evento',
      model: this.#model,
      input: { transcripcion: input.transcripcion, finca_id: input.finca_id },
    })

    const inicio = Date.now()
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const result = await gemini.generateContent(mensajeCompleto)
      const texto = result.response.text()
      const latencia = Date.now() - inicio

      let json: unknown
      try {
        json = JSON.parse(texto)
      } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Gemini devolvió respuesta no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = EventoCampoExtraidoSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data, usage: { totalTokens: 0 }, metadata: { latencia_ms: latencia } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error de Gemini SDK: ${String(err)}`, err)
    }
  }

  async corregirTranscripcion(raw: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'corregir_transcripcion', model: this.#model, input: { raw } })
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-02-post-correccion-stt.md')
      const result = await gemini.generateContent(`${prompt}\n\nTranscripción: ${raw}`)
      const corrected = result.response.text().trim()
      generation.end({ output: corrected })
      return corrected
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error corrigiendo transcripción: ${String(err)}`, err)
    }
  }

  async analizarImagen(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'analizar_imagen', model: this.#model, input: { imageUrl } })
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-03-analisis-imagen.md')
      const result = await gemini.generateContent([prompt, { inlineData: { mimeType: 'image/jpeg', data: imageUrl } }])
      const analisis = result.response.text()
      generation.end({ output: analisis })
      return analisis
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error analizando imagen: ${String(err)}`, err)
    }
  }

  async onboardarAdmin(_mensaje: string, _contexto: ContextoConversacion, _traceId: string): Promise<RespuestaOnboarding> {
    throw new LLMError('GEMINI_ERROR', 'GeminiLLM: onboardarAdmin no implementado — usa GroqLLM')
  }

  async onboardarAgricultor(_mensaje: string, _contexto: ContextoOnboardingAgricultor, _traceId: string): Promise<RespuestaOnboarding> {
    throw new LLMError('GEMINI_ERROR', 'GeminiLLM: onboardarAgricultor no implementado — usa GroqLLM')
  }

  async atenderProspecto(_mensaje: string, _contexto: ContextoProspecto, _traceId: string): Promise<RespuestaProspecto> {
    throw new LLMError('GEMINI_ERROR', 'GeminiLLM: atenderProspecto no implementado — usa GroqLLM')
  }

  async resumirSemana(entrada: EntradaResumenSemanal, traceId: string): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'resumir_semana', model: this.#model, input: { finca_id: entrada.finca_id, total_eventos: entrada.eventos.length } })
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-05-resumen-semanal.md')
      const result = await gemini.generateContent(`${prompt}\n\nFinca: ${entrada.finca_nombre}\nCultivo: ${entrada.cultivo_principal}\nSemana: ${entrada.fecha_inicio} al ${entrada.fecha_fin}\n\nEventos:\n${JSON.stringify(entrada.eventos, null, 2)}`)
      const texto = result.response.text()
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', 'Gemini no devolvió JSON para resumen semanal')
      }
      generation.end({ output: json })
      return json as ResumenSemanal
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error en resumen semanal: ${String(err)}`, err)
    }
  }
}

function cargarPrompt(nombre: string): string {
  try {
    return readFileSync(join(process.cwd(), 'prompts', nombre), 'utf-8')
  } catch (err) {
    throw new LLMError('PARSE_ERROR', `Prompt requerido no encontrado: prompts/${nombre}`, err)
  }
}
