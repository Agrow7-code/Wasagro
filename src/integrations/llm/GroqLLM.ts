import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'
import { z } from 'zod'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import type { IWasagroLLM } from './IWasagroLLM.js'
import { LLMError } from './LLMError.js'
import {
  EventoCampoExtraidoSchema,
  sinEvento,
  type EntradaEvento,
  type EventoCampoExtraido,
} from '../../types/dominio/EventoCampo.js'
import {
  RespuestaOnboardingSchema,
  type ContextoConversacion,
  type ContextoOnboardingAgricultor,
  type RespuestaOnboarding,
} from '../../types/dominio/Onboarding.js'
import type { ContextoProspecto, RespuestaProspecto } from '../../types/dominio/Prospecto.js'
import { ResumenSemanalSchema, type ResumenSemanal, type EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

const EXTRACTOR_POR_TIPO: Record<string, string> = {
  insumo: 'sp-01a-extractor-insumo.md',
  labor: 'sp-01b-extractor-labor.md',
  cosecha: 'sp-01c-extractor-cosecha.md',
  plaga: 'sp-01d-extractor-plaga.md',
  infraestructura: 'sp-01e-extractor-infraestructura.md',
  clima: 'sp-01f-extractor-clima.md',
}

const ResultadoClasificacionSchema = z.object({
  tipo_evento: z.enum(['insumo', 'labor', 'cosecha', 'plaga', 'clima', 'infraestructura', 'consulta', 'saludo', 'ambiguo']),
  confidence: z.number().min(0).max(1),
  requiere_imagen_para_confirmar: z.boolean().default(false),
  motivo_ambiguo: z.string().nullable().default(null),
  mensaje_clarificacion: z.string().nullable().default(null),
})

type ResultadoClasificacion = z.infer<typeof ResultadoClasificacionSchema>

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
    const trace = this.#lf.trace({ id: traceId })

    // Paso 1 — clasificar
    const clasificacion = await this.#clasificar(input, traceId)

    // Paso 2 — manejar no-eventos
    if (clasificacion.tipo_evento === 'saludo') {
      trace.event({ name: 'mensaje_saludo', input: { transcripcion: input.transcripcion } })
      return sinEvento('¡Hola! ¿Qué pasó hoy en la finca?')
    }

    if (clasificacion.tipo_evento === 'consulta') {
      trace.event({ name: 'mensaje_consulta', input: { transcripcion: input.transcripcion } })
      return sinEvento('Claro, ¿qué necesitas? Si tienes algo que reportar de la finca, mándame el mensaje.')
    }

    if (clasificacion.tipo_evento === 'ambiguo') {
      const pregunta = clasificacion.mensaje_clarificacion ?? '¿Puedes contarme más sobre lo que pasó en la finca?'
      return {
        tipo_evento: 'observacion',
        lote_id: null,
        lote_detectado_raw: null,
        fecha_evento: null,
        confidence_score: clasificacion.confidence,
        requiere_validacion: false,
        alerta_urgente: false,
        campos_extraidos: {},
        confidence_por_campo: {},
        campos_faltantes: [],
        requiere_clarificacion: true,
        pregunta_sugerida: pregunta,
      }
    }

    // Paso 3 — extraer con prompt especializado
    return await this.#extraerEspecializado(clasificacion, input, traceId)
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

  async onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'onboardar_admin', model: this.#model, input: { mensaje } })
    try {
      const prompt = injectarVariables(cargarPrompt('sp-04a-onboarding-admin.md'), {
        PASO_ACTUAL: String(contexto.preguntas_realizadas + 1),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#llamar(prompt, `Historial:\n${historial}\nUsuario: ${mensaje}`)

      let json: unknown
      try { json = JSON.parse(texto) } catch {
        json = { paso_completado: 0, siguiente_paso: 1, mensaje_para_usuario: texto, onboarding_completo: false }
      }

      const parsed = RespuestaOnboardingSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema onboarding admin inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en onboarding admin: ${String(err)}`, err)
    }
  }

  async onboardarAgricultor(mensaje: string, contexto: ContextoOnboardingAgricultor, traceId: string): Promise<RespuestaOnboarding> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'onboardar_agricultor', model: this.#model, input: { mensaje } })
    try {
      const prompt = injectarVariables(cargarPrompt('sp-04b-onboarding-agricultor.md'), {
        PASO_ACTUAL: String(contexto.paso_actual),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        FINCAS_DISPONIBLES: contexto.fincas_disponibles,
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#llamar(prompt, `Historial:\n${historial}\nUsuario: ${mensaje}`)

      let json: unknown
      try { json = JSON.parse(texto) } catch {
        json = { paso_completado: 0, siguiente_paso: 1, mensaje_para_usuario: texto, onboarding_completo: false }
      }

      const parsed = RespuestaOnboardingSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema onboarding agricultor inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en onboarding agricultor: ${String(err)}`, err)
    }
  }

  async atenderProspecto(mensaje: string, contexto: ContextoProspecto, traceId: string): Promise<RespuestaProspecto> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'atender_prospecto', model: this.#model, input: { mensaje } })
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      const prompt = injectarVariables(cargarPrompt('sp-00-prospecto.md'), {
        PASO_ACTUAL: String(contexto.paso_actual),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recopilados),
        FECHA_ACTUAL: hoy,
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#llamar(prompt, `Historial:\n${historial}\nUsuario: ${mensaje}`)

      let json: unknown
      try { json = JSON.parse(texto) } catch {
        json = {
          paso_completado: 0, siguiente_paso: 1,
          tipo_contacto: 'sin_clasificar',
          datos_extraidos: { nombre: null, finca_nombre: null, cultivo_principal: null, pais: null, tamanio_aproximado: null, interes_demo: false },
          guardar_en_prospectos: false,
          mensaje_para_usuario: texto,
        }
      }

      generation.end({ output: json })
      return json as RespuestaProspecto
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error atendiendo prospecto: ${String(err)}`, err)
    }
  }

  async resumirSemana(entrada: EntradaResumenSemanal, traceId: string): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'resumir_semana', model: this.#model, input: { finca_id: entrada.finca_id, total_eventos: entrada.eventos.length } })
    try {
      const prompt = injectarVariables(cargarPrompt('sp-05-resumen-semanal.md'), {
        FINCA_NOMBRE: entrada.finca_nombre,
        CULTIVO_PRINCIPAL: entrada.cultivo_principal,
        FECHA_INICIO: entrada.fecha_inicio,
        FECHA_FIN: entrada.fecha_fin,
        EVENTOS_AGREGADOS: JSON.stringify(entrada.eventos, null, 2),
      })
      const texto = await this.#llamar(prompt, `Finca: ${entrada.finca_nombre}. Genera el resumen de los eventos de la semana.`)
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', 'Groq no devolvió JSON para resumen semanal')
      }
      const parsed = ResumenSemanalSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema resumen semanal inválido: ${parsed.error.message}`)
      }
      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en resumen semanal: ${String(err)}`, err)
    }
  }

  // ─── private ─────────────────────────────────────────────────────────────

  async #clasificar(input: EntradaEvento, traceId: string): Promise<ResultadoClasificacion> {
    const prompt = injectarVariables(cargarPrompt('sp-00-clasificador.md'), {
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'clasificar_mensaje',
      model: this.#model,
      input: { transcripcion: input.transcripcion },
    })

    try {
      const texto = await this.#llamar(prompt, input.transcripcion)
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Clasificador devolvió no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = ResultadoClasificacionSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema clasificación inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en clasificador: ${String(err)}`, err)
    }
  }

  async #extraerEspecializado(
    clasificacion: ResultadoClasificacion,
    input: EntradaEvento,
    traceId: string,
  ): Promise<EventoCampoExtraido> {
    const promptFile = EXTRACTOR_POR_TIPO[clasificacion.tipo_evento] ?? 'sp-01-extraccion-evento.md'

    const prompt = injectarVariables(cargarPrompt(promptFile), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados',
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: `extraer_${clasificacion.tipo_evento}`,
      model: this.#model,
      input: { transcripcion: input.transcripcion, tipo: clasificacion.tipo_evento },
    })

    const inicio = Date.now()
    try {
      const texto = await this.#llamar(prompt, `Transcripción: ${input.transcripcion}`)
      const latencia = Date.now() - inicio

      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Extractor devolvió no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = EventoCampoExtraidoSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema extractor inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data, metadata: { latencia_ms: latencia } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error extrayendo ${clasificacion.tipo_evento}: ${String(err)}`, err)
    }
  }

  async #llamar(systemPrompt: string, userContent: string): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ]
    if (userContent) {
      messages.push({ role: 'user', content: userContent })
    }
    const res = await this.#client.chat.completions.create({
      model: this.#model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })
    return res.choices[0]?.message.content ?? ''
  }

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
