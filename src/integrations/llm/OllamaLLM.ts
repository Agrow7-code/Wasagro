import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import type { IWasagroLLM } from './IWasagroLLM.js'
import { LLMError } from './LLMError.js'
import { EventoCampoExtraidoSchema, type EntradaEvento, type EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ResumenSemanal } from '../../types/dominio/Resumen.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'

interface OllamaLLMConfig {
  baseUrl?: string
  model?: string
  fetchClient?: typeof fetch
  langfuseClient?: Langfuse
}

interface OllamaChatResponse {
  message: { content: string }
}

export class OllamaLLM implements IWasagroLLM {
  readonly #baseUrl: string
  readonly #model: string
  readonly #fetch: typeof fetch
  readonly #lf: Langfuse

  constructor(config: OllamaLLMConfig = {}) {
    this.#baseUrl = config.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
    this.#model = config.model ?? process.env['OLLAMA_MODEL'] ?? 'llama3.2'
    this.#fetch = config.fetchClient ?? globalThis.fetch
    this.#lf = config.langfuseClient ?? langfuseDefault
  }

  async extraerEvento(input: EntradaEvento, traceId: string): Promise<EventoCampoExtraido> {
    const prompt = injectarVariables(cargarPrompt('sp-01-extraccion-evento.md'), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados',
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
    })
    const contenido = `${prompt}\n\nTranscripción: ${input.transcripcion}`

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'extraer_evento',
      model: this.#model,
      input: { transcripcion: input.transcripcion },
    })

    const inicio = Date.now()
    try {
      const respuesta = await this.#llamar(contenido)
      const latencia = Date.now() - inicio

      let json: unknown
      try {
        json = JSON.parse(respuesta)
      } catch {
        generation.end({ output: respuesta, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Ollama devolvió respuesta no-JSON: ${respuesta.slice(0, 100)}`)
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
      throw this.#envolverError(err)
    }
  }

  async corregirTranscripcion(raw: string, traceId: string): Promise<string> {
    const prompt = cargarPrompt('sp-02-post-correccion-stt.md')
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'corregir_transcripcion', model: this.#model, input: { raw } })
    try {
      const corrected = await this.#llamar(`${prompt}\n\nTranscripción: ${raw}`)
      generation.end({ output: corrected })
      return corrected.trim()
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw this.#envolverError(err)
    }
  }

  async analizarImagen(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'analizar_imagen', model: this.#model, input: { imageUrl } })
    try {
      const prompt = cargarPrompt('sp-03-analisis-imagen.md')
      const analisis = await this.#llamar(`${prompt}\n\nURL imagen: ${imageUrl}`)
      generation.end({ output: analisis })
      return analisis
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw this.#envolverError(err)
    }
  }

  async onboardar(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding> {
    // Regla 2: máximo 2 preguntas de clarificación sin completar → fallback
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
      const texto = await this.#llamar(`${prompt}\n\nHistorial:\n${historial}\nUsuario: ${mensaje}`)
      let json: unknown
      try { json = JSON.parse(texto) } catch { json = { mensaje: texto, onboarding_completo: false, siguiente_pregunta: null } }
      generation.end({ output: json })
      return json as RespuestaOnboarding
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw this.#envolverError(err)
    }
  }

  async resumirSemana(eventos: EventoCampoExtraido[], traceId: string): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'resumir_semana', model: this.#model, input: { total_eventos: eventos.length } })
    try {
      const prompt = cargarPrompt('sp-05-resumen-semanal.md')
      const texto = await this.#llamar(`${prompt}\n\nEventos:\n${JSON.stringify(eventos, null, 2)}`)
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        throw new LLMError('PARSE_ERROR', 'Ollama no devolvió JSON para resumen semanal')
      }
      generation.end({ output: json })
      return json as ResumenSemanal
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw this.#envolverError(err)
    }
  }

  async #llamar(contenido: string): Promise<string> {
    const res = await this.#fetch(`${this.#baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#model,
        messages: [{ role: 'user', content: contenido }],
        format: 'json',
        stream: false,
      }),
    })

    if (!res.ok) {
      throw new LLMError('OLLAMA_UNAVAILABLE', `Ollama respondió HTTP ${res.status}`)
    }

    const data = await res.json() as OllamaChatResponse
    return data.message.content
  }

  #envolverError(err: unknown): LLMError {
    const msg = String(err)
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return new LLMError('OLLAMA_UNAVAILABLE', `Ollama no disponible en ${this.#baseUrl} — ¿está corriendo?`, err)
    }
    return new LLMError('GEMINI_ERROR', `Error inesperado en OllamaLLM: ${msg}`, err)
  }
}

function cargarPrompt(nombre: string): string {
  try {
    return readFileSync(join(process.cwd(), 'prompts', nombre), 'utf-8')
  } catch (err) {
    throw new LLMError('PARSE_ERROR', `Prompt requerido no encontrado: prompts/${nombre}`, err)
  }
}
