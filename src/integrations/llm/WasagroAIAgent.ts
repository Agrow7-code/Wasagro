import { PromptManager } from '../../pipeline/promptManager.js'
import { z } from 'zod'
import type { Langfuse } from 'langfuse'
import { langfuse as langfuseDefault } from '../langfuse.js'
import type { IWasagroLLM } from './IWasagroLLM.js'
import { LLMError } from './LLMError.js'
import {
  ExtraccionMultiEventoSchema,
  EventoCampoExtraidoSchema,
  sinEvento,
  type EntradaEvento,
  type ExtraccionMultiEvento,
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
import { RespuestaSDRSchema, type EntradaSDR, type RespuestaSDR } from '../../types/dominio/SDRTypes.js'
import { buildSDRContexto } from './sdrUtils.js'
import { ClasificacionExcelSchema, type ClasificacionExcel, type EntradaClasificacionExcel } from '../../types/dominio/Excel.js'


const EXTRACTOR_POR_TIPO: Record<string, string> = {
  insumo: 'sp-01a-extractor-insumo.md',
  labor: 'sp-01b-extractor-labor.md',
  cosecha: 'sp-01c-extractor-cosecha.md',
  plaga: 'sp-01d-extractor-plaga.md',
  infraestructura: 'sp-01e-extractor-infraestructura.md',
  clima: 'sp-01f-extractor-clima.md',
  calidad: 'sp-01g-extractor-calidad.md',
  venta: 'sp-01h-extractor-venta.md',
  gasto: 'sp-01i-extractor-gasto.md',
}

const ResultadoClasificacionSchema = z.object({
  tipos_evento: z.array(z.enum(['insumo', 'labor', 'cosecha', 'calidad', 'venta', 'gasto', 'plaga', 'clima', 'infraestructura', 'consulta', 'saludo', 'ambiguo'])),
  confidence: z.number().min(0).max(1),
  requiere_imagen_para_confirmar: z.boolean().default(false),
  motivo_ambiguo: z.string().nullable().default(null),
  mensaje_clarificacion: z.string().nullable().default(null),
})

type ResultadoClasificacion = z.infer<typeof ResultadoClasificacionSchema>

  import type { ILLMAdapter } from './ILLMAdapter.js'

export class WasagroAIAgent implements IWasagroLLM {
  readonly #adapter: ILLMAdapter
  readonly #lf: Langfuse

  constructor(adapter: ILLMAdapter, lf?: Langfuse) {
    this.#adapter = adapter
    this.#lf = lf ?? langfuseDefault
  }

  async extraerEventos(input: EntradaEvento, traceId: string): Promise<ExtraccionMultiEvento> {
    const trace = this.#lf.trace({ id: traceId })

    // Paso 1 — clasificar (o usar tipos forzados si el orquestador ya lo resolvió)
    let clasificacion: ResultadoClasificacion;
    
    if (input.tipos_forzados && input.tipos_forzados.length > 0) {
      clasificacion = { tipos_evento: input.tipos_forzados as any, confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else if (input.tipo_forzado) {
      clasificacion = { tipos_evento: [input.tipo_forzado as any], confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else {
      clasificacion = await this.#clasificar(input, traceId)
    }

    // Paso 2 — manejar no-eventos puros (si solo es saludo o consulta)
    if (clasificacion.tipos_evento.length === 1) {
      const tipoUnico = clasificacion.tipos_evento[0];
      if (tipoUnico === 'saludo') {
        trace.event({ name: 'mensaje_saludo', input: { transcripcion: input.transcripcion } })
        return sinEvento('¡Hola! ¿Qué pasó hoy en la finca?')
      }
      if (tipoUnico === 'consulta') {
        trace.event({ name: 'mensaje_consulta', input: { transcripcion: input.transcripcion } })
        return sinEvento('Claro, ¿qué necesitas? Si tienes algo que reportar de la finca, mándame el mensaje.')
      }
      if (tipoUnico === 'ambiguo') {
        const pregunta = clasificacion.mensaje_clarificacion ?? '¿Puedes contarme más sobre lo que pasó en la finca?'
        return {
          eventos: [{
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
          }],
          pregunta_sugerida: pregunta,
        }
      }
    }

    // Paso 3 — Filtrar tipos válidos para extracción y ejecutar agentes en paralelo
    const tiposValidos = clasificacion.tipos_evento.filter(t => !['saludo', 'consulta', 'ambiguo'].includes(t));
    
    if (tiposValidos.length === 0) {
      return sinEvento('No pude identificar qué evento reportas. ¿Me lo explicas de otra forma?');
    }

    const promesasExtraccion = tiposValidos.map(tipo => {
      // Creamos una pseudo-clasificación para cada agente especialista
      const pseudoClasif: ResultadoClasificacion = {
        ...clasificacion,
        tipos_evento: [tipo] // el agente especialista solo se enfoca en su tipo
      };
      return this.#extraerEspecializado(pseudoClasif, tipo, input, traceId);
    });

    const eventosExtraidos = await Promise.all(promesasExtraccion);

    // Determinar si hay alguna pregunta sugerida (tomamos la primera válida para no abrumar al usuario)
    const eventoConPregunta = eventosExtraidos.find(e => e.requiere_clarificacion && e.pregunta_sugerida);

    return {
      eventos: eventosExtraidos.map(e => {
        // Limpiamos la pregunta sugerida individual para cumplir con ExtraccionMultiEventoSchema
        const { pregunta_sugerida, ...resto } = e;
        return resto as any;
      }),
      pregunta_sugerida: eventoConPregunta?.pregunta_sugerida
    }
  }

  async corregirTranscripcion(raw: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'corregir_transcripcion', model: 'wasagro-ai-agent', input: { raw } })
    try {
      const prompt = (await PromptManager.getPrompt('sp-02-post-correccion-stt.md', 'prompts/sp-02-post-correccion-stt.md', typeof traceId !== 'undefined' ? traceId : undefined))
      const corrected = await this.#adapter.generarTexto(`Transcripción: ${raw}`, { systemPrompt: prompt, responseFormat: 'text', traceId, generationName: 'llamarLibre' })
      generation.end({ output: corrected })
      return corrected.trim()
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error corrigiendo transcripción: ${String(err)}`, err)
    }
  }

  async analizarImagen(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'analizar_imagen', model: 'wasagro-ai-agent', input: { imageUrl } })
    try {
      const prompt = (await PromptManager.getPrompt('sp-03-analisis-imagen.md', 'prompts/sp-03-analisis-imagen.md', typeof traceId !== 'undefined' ? traceId : undefined))
      const analisis = await this.#adapter.generarTexto(`URL imagen: ${imageUrl}`, { systemPrompt: prompt, responseFormat: 'text', traceId, generationName: 'llamarLibre' })
      generation.end({ output: analisis })
      return analisis
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error analizando imagen: ${String(err)}`, err)
    }
  }

  async onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'onboardar_admin', model: 'wasagro-ai-agent', input: { mensaje } })
    try {
      const prompt = injectarVariables((await PromptManager.getPrompt('sp-04a-onboarding-admin.md', 'prompts/sp-04a-onboarding-admin.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        PASO_ACTUAL: String(contexto.preguntas_realizadas + 1),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#adapter.generarTexto(`Historial:\n${historial}\nUsuario: ${mensaje}`, { systemPrompt: prompt, responseFormat: 'json_object', traceId, generationName: 'llamar' })

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
    const generation = trace.generation({ name: 'onboardar_agricultor', model: 'wasagro-ai-agent', input: { mensaje } })
    try {
      const prompt = injectarVariables((await PromptManager.getPrompt('sp-04b-onboarding-agricultor.md', 'prompts/sp-04b-onboarding-agricultor.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        PASO_ACTUAL: String(contexto.paso_actual),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        FINCAS_DISPONIBLES: contexto.fincas_disponibles,
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#adapter.generarTexto(`Historial:\n${historial}\nUsuario: ${mensaje}`, { systemPrompt: prompt, responseFormat: 'json_object', traceId, generationName: 'llamar' })

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
    const generation = trace.generation({ name: 'atender_prospecto', model: 'wasagro-ai-agent', input: { mensaje } })
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      const prompt = injectarVariables((await PromptManager.getPrompt('sp-00-prospecto.md', 'prompts/sp-00-prospecto.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        PASO_ACTUAL: String(contexto.paso_actual),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recopilados),
        FECHA_ACTUAL: hoy,
      })
      const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
      const texto = await this.#adapter.generarTexto(`Historial:\n${historial}\nUsuario: ${mensaje}`, { systemPrompt: prompt, responseFormat: 'json_object', traceId, generationName: 'llamar' })

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
    const generation = trace.generation({ name: 'resumir_semana', model: 'wasagro-ai-agent', input: { finca_id: entrada.finca_id, total_eventos: entrada.eventos.length } })
    try {
      const prompt = injectarVariables((await PromptManager.getPrompt('sp-05-resumen-semanal.md', 'prompts/sp-05-resumen-semanal.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        FINCA_NOMBRE: entrada.finca_nombre,
        CULTIVO_PRINCIPAL: entrada.cultivo_principal,
        FECHA_INICIO: entrada.fecha_inicio,
        FECHA_FIN: entrada.fecha_fin,
        EVENTOS_AGREGADOS: JSON.stringify(entrada.eventos, null, 2),
      })
      const texto = await this.#adapter.generarTexto(`Finca: ${entrada.finca_nombre}. Genera el resumen de los eventos de la semana.`, { systemPrompt: prompt, responseFormat: 'json_object', traceId, generationName: 'llamar' })
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', 'Adapter no devolvió JSON para resumen semanal')
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

  async atenderSDR(entrada: EntradaSDR, traceId: string): Promise<RespuestaSDR> {
    const promptBase = await PromptManager.getPrompt('SP-SDR-01-master.md', 'sdr/prompts/SP-SDR-01-master.md', typeof traceId !== 'undefined' ? traceId : undefined)
    const contexto = buildSDRContexto(entrada)
    const userContent = `${contexto}\n\nMensaje del prospecto: ${entrada.mensaje}`

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'atender_sdr',
      model: 'wasagro-ai-agent',
      input: { turno: entrada.turno, segmento: entrada.segmento_icp, narrativa: entrada.narrativa },
    })

    const inicio = Date.now()
    try {
      const texto = await this.#adapter.generarTexto(userContent, { systemPrompt: promptBase, responseFormat: 'json_object', traceId, generationName: 'llamar' })
      const latencia = Date.now() - inicio

      let json: unknown
      try {
        json = JSON.parse(texto)
      } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Adapter SDR devolvió respuesta no-JSON: ${texto.slice(0, 100)}`)
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
      throw new LLMError('GROQ_ERROR', `Error en SDR: ${String(err)}`, err)
    }
  }

  async clasificarExcel(entrada: EntradaClasificacionExcel, traceId: string): Promise<ClasificacionExcel> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'clasificar_excel',
      model: 'wasagro-ai-agent',
      input: { nombre_archivo: entrada.nombre_archivo, total_filas: entrada.total_filas, columnas: entrada.columnas },
    })
    try {
      const prompt = injectarVariables((await PromptManager.getPrompt('sp-06-clasificar-excel.md', 'prompts/sp-06-clasificar-excel.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        FINCA_NOMBRE: entrada.finca_nombre ?? 'No especificada',
        CULTIVO_PRINCIPAL: entrada.cultivo_principal ?? 'No especificado',
        NOMBRE_ARCHIVO: entrada.nombre_archivo,
        COLUMNAS: entrada.columnas.join(', '),
        MUESTRA_FILAS: JSON.stringify(entrada.muestra_filas, null, 2),
        TOTAL_FILAS: String(entrada.total_filas),
      })
      const userContent = `Archivo: ${entrada.nombre_archivo}. Columnas: ${entrada.columnas.join(', ')}. Total filas: ${entrada.total_filas}.`
      const texto = await this.#adapter.generarTexto(userContent, { systemPrompt: prompt, responseFormat: 'json_object', traceId, generationName: 'llamar' })
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Clasificador Excel devolvió no-JSON: ${texto.slice(0, 100)}`)
      }
      const parsed = ClasificacionExcelSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema clasificación Excel inválido: ${parsed.error.message}`)
      }
      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error clasificando Excel: ${String(err)}`, err)
    }
  }

  // ─── private ─────────────────────────────────────────────────────────────

  async #clasificar(input: EntradaEvento, traceId: string): Promise<ResultadoClasificacion> {
    const prompt = injectarVariables((await PromptManager.getPrompt('sp-00-clasificador.md', 'prompts/sp-00-clasificador.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'clasificar_mensaje',
      model: 'wasagro-ai-agent',
      input: { transcripcion: input.transcripcion },
    })

    const inicio = Date.now()
    try {
      const texto = await this.#adapter.generarTexto(input.transcripcion, { 
        systemPrompt: prompt, 
        responseFormat: 'json_object', 
        traceId, 
        generationName: 'llamar',
        modelClass: 'fast' // Enrutamiento ultra-rápido (Flash)
      })
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

      generation.end({ output: parsed.data, metadata: { latencia_ms: Date.now() - inicio } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en clasificador: ${String(err)}`, err)
    }
  }

  async #extraerEspecializado(
    clasificacion: ResultadoClasificacion,
    tipo_evento: string,
    input: EntradaEvento,
    traceId: string,
  ): Promise<EventoCampoExtraido> {
    const promptFile = EXTRACTOR_POR_TIPO[tipo_evento] ?? 'sp-01-extraccion-evento.md'

    const estadoParcialJSON = input.estado_parcial ? JSON.stringify(input.estado_parcial, null, 2) : 'No hay borrador previo'

    const prompt = injectarVariables((await PromptManager.getPrompt(promptFile, `prompts/${promptFile}`, typeof traceId !== 'undefined' ? traceId : undefined)), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados',
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
      CONTEXTO_HISTORICO: input.contexto_rag ?? '',
      ESTADO_PARCIAL: estadoParcialJSON,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: `extraer_${tipo_evento}`,
      model: 'wasagro-ai-agent',
      input: { transcripcion: input.transcripcion, tipo: tipo_evento },
    })

    const inicio = Date.now()
    try {
      const texto = await this.#adapter.generarTexto(`Transcripción: ${input.transcripcion}`, { 
        systemPrompt: prompt, 
        responseFormat: 'json_object', 
        traceId, 
        generationName: 'llamar',
        modelClass: 'reasoning' // Extracción profunda y validación cruzada (Pro)
      })
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
      throw new LLMError('GROQ_ERROR', `Error extrayendo ${tipo_evento}: ${String(err)}`, err)
    }
  }

  
}
