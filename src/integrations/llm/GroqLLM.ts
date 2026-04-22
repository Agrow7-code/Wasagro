import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import type { IWasagroLLM } from './IWasagroLLM.js'
import { LLMError } from './LLMError.js'
import { EventoCampoExtraidoSchema, type EntradaEvento, type EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ResumenSemanal } from '../../types/dominio/Resumen.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

interface GroqLLMConfig {
  apiKey: string
  model?: string
  sdkClient?: OpenAI
  langfuseClient?: Langfuse
}

export class GroqLLM implements IWasagroLLM {
  readonly #client: OpenAI
  readonly #model: string
  readonly #lf: Langfuse

  constructor(config: GroqLLMConfig) {
    this.#model = config.model ?? process.env['GROQ_MODEL'] ?? DEFAULT_MODEL
    this.#client = config.sdkClient ?? new OpenAI({
      apiKey: config.apiKey,
      baseURL: GROQ_BASE_URL,
    })
    this.#lf = config.langfuseClient ?? langfuseDefault
  }

  async extraerEvento(input: EntradaEvento, traceId: string): Promise<EventoCampoExtraido> {
    const prompt = injectarVariables(cargarPrompt('sp-01-extraccion-evento.md'), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados',
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'extraer_evento',
      model: this.#model,
      input: { transcripcion: input.transcripcion, finca_id: input.finca_id },
    })

    const inicio = Date.now()
    try {
      const texto = await this.#llamar(prompt, `Transcripción: ${input.transcripcion}`)
      const latencia = Date.now() - inicio

      let json: unknown
      try {
        json = JSON.parse(texto)
      } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Groq devolvió respuesta no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = EventoCampoExtraidoSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data, metadata: { latencia_ms: latencia } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error de Groq: ${String(err)}`, err)
    }
  }

  async corregirTranscripcion(raw: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'corregir_transcripcion', model: this.#model, input: { raw } })
    try {
      const prompt = cargarPrompt('sp-02-post-correccion-stt.md')
      const corrected = await this.#llamarLibre(prompt, `Transcripción: ${raw}`)
      generation.end({ output: corrected })
      return corrected.trim()
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error corrigiendo transcripción: ${String(err)}`, err)
    }
  }

  async analizarImagen(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'analizar_imagen', model: this.#model, input: { imageUrl } })
    try {
      const prompt = cargarPrompt('sp-03-analisis-imagen.md')
      const analisis = await this.#llamarLibre(prompt, `URL imagen: ${imageUrl}`)
      generation.end({ output: analisis })
      return analisis
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error analizando imagen: ${String(err)}`, err)
    }
  }

  async onboardar(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding> {
    if (contexto.preguntas_realizadas >= 2) {
      this.#lf.trace({ id: traceId }).event({
        name: 'onboarding_max_questions_reached',
        level: 'WARNING',
        input: { preguntas_realizadas: contexto.preguntas_realizadas },
      })
      return {
        mensaje: 'Listo, completaremos tu registro más adelante. Un asesor te contactará pronto. ✅',
        onboarding_completo: false,
        siguiente_pregunta: null,
      }
    }

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'onboardar', model: this.#model, input: { mensaje } })
    try {
      const prompt = injectarVariables(cargarPrompt('sp-04-onboarding.md'), {
        PASO_ACTUAL: String(contexto.preguntas_realizadas + 1),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#llamar(prompt, `Historial:\n${historial}\nUsuario: ${mensaje}`)
      let json: unknown
      try { json = JSON.parse(texto) } catch { json = { mensaje: texto, onboarding_completo: false, siguiente_pregunta: null } }
      generation.end({ output: json })
      return json as RespuestaOnboarding
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en onboarding: ${String(err)}`, err)
    }
  }

  async resumirSemana(eventos: EventoCampoExtraido[], traceId: string): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'resumir_semana', model: this.#model, input: { total_eventos: eventos.length } })
    try {
      const prompt = cargarPrompt('sp-05-resumen-semanal.md')
      const texto = await this.#llamar(prompt, `Eventos:\n${JSON.stringify(eventos, null, 2)}`)
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        throw new LLMError('PARSE_ERROR', 'Groq no devolvió JSON para resumen semanal')
      }
      generation.end({ output: json })
      return json as ResumenSemanal
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en resumen semanal: ${String(err)}`, err)
    }
  }

  // JSON mode — para extracción estructurada
  async #llamar(systemPrompt: string, userContent: string): Promise<string> {
    const res = await this.#client.chat.completions.create({
      model: this.#model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
    return res.choices[0]?.message.content ?? ''
  }

  // Texto libre — para transcripción y análisis de imagen
  async #llamarLibre(systemPrompt: string, userContent: string): Promise<string> {
    const res = await this.#client.chat.completions.create({
      model: this.#model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    })
    return res.choices[0]?.message.content ?? ''
  }
}

function cargarPrompt(nombre: string): string {
  try {
    return readFileSync(join(process.cwd(), 'prompts', nombre), 'utf-8')
  } catch (err) {
    throw new LLMError('PARSE_ERROR', `Prompt requerido no encontrado: prompts/${nombre}`, err)
  }
}
