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
import { ResumenSemanalSchema, type ResumenSemanal, type EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import { RespuestaSDRSchema, type EntradaSDR, type RespuestaSDR } from '../../types/dominio/SDRTypes.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'
import { cargarSDRPrompt, buildSDRContexto } from './sdrUtils.js'

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
    const inicio = Date.now()
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-02-post-correccion-stt.md')
      const result = await gemini.generateContent(`${prompt}\n\nTranscripción: ${raw}`)
      const corrected = result.response.text().trim()
      generation.end({ output: corrected, metadata: { latencia_ms: Date.now() - inicio } })
      return corrected
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error corrigiendo transcripción: ${String(err)}`, err)
    }
  }

  async analizarImagen(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'analizar_imagen', model: this.#model, input: { imageUrl } })
    const inicio = Date.now()
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-03-analisis-imagen.md')
      const result = await gemini.generateContent([prompt, { inlineData: { mimeType: 'image/jpeg', data: imageUrl } }])
      const analisis = result.response.text()
      generation.end({ output: analisis, metadata: { latencia_ms: Date.now() - inicio } })
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

  async atenderSDR(entrada: EntradaSDR, traceId: string): Promise<RespuestaSDR> {
    const promptBase = cargarSDRPrompt('SP-SDR-01-master.md')
    const contexto = buildSDRContexto(entrada)
    const mensajeCompleto = `${promptBase}\n\n${contexto}\n\nMensaje del prospecto: ${entrada.mensaje}`

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'atender_sdr',
      model: this.#model,
      input: { turno: entrada.turno, segmento: entrada.segmento_icp, narrativa: entrada.narrativa },
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
        throw new LLMError('PARSE_ERROR', `Gemini SDR devolvió respuesta no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = RespuestaSDRSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `SDR schema inválido: ${parsed.error.message}`)
      }

      generation.end({ output: { action: parsed.data.action, score_delta: parsed.data.score_delta }, metadata: { latencia_ms: latencia } })
      trace.event({ name: 'sdr_narrative_ab', input: { narrativa: entrada.narrativa, segmento: entrada.segmento_icp, turno: entrada.turno } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GEMINI_ERROR', `Error en SDR: ${String(err)}`, err)
    }
  }

  async resumirSemana(entrada: EntradaResumenSemanal, traceId: string): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'resumir_semana', model: this.#model, input: { finca_id: entrada.finca_id, total_eventos: entrada.eventos.length } })
    const inicio = Date.now()
    try {
      const gemini = this.#sdk.getGenerativeModel({ model: this.#model })
      const prompt = cargarPrompt('sp-05-resumen-semanal.md')
      const result = await gemini.generateContent(`${prompt}\n\nFinca: ${entrada.finca_nombre}\nCultivo: ${entrada.cultivo_principal}\nSemana: ${entrada.fecha_inicio} al ${entrada.fecha_fin}\n\nEventos:\n${JSON.stringify(entrada.eventos, null, 2)}`)
      const texto = result.response.text()
      const latencia = Date.now() - inicio
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', 'Gemini no devolvió JSON para resumen semanal')
      }
      const parsed = ResumenSemanalSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Resumen semanal schema inválido: ${parsed.error.message}`)
      }
      generation.end({ output: parsed.data, metadata: { latencia_ms: latencia } })
      return parsed.data
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


