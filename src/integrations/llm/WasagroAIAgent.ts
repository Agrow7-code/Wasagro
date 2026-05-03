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
  type ResultadoIntentGate,
} from '../../types/dominio/EventoCampo.js'
import {
  RespuestaOnboardingSchema,
  type ContextoConversacion,
  type ContextoOnboardingAgricultor,
  type RespuestaOnboarding,
} from '../../types/dominio/Onboarding.js'
import type { ContextoProspecto, RespuestaProspecto } from '../../types/dominio/Prospecto.js'
import { ResumenSemanalSchema, type ResumenSemanal, type EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import { DescripcionVisualSchema, DiagnosticoV2VKSchema, type DiagnosticoV2VK } from '../../types/dominio/Vision.js'
import { ResultadoOCRSchema, type ResultadoOCR } from '../../types/dominio/OCR.js'
import type { ContextoOCR } from './IWasagroLLM.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'
import { ExtraccionSDRSchema, type EntradaSDR, type ExtraccionSDR } from '../../types/dominio/SDRTypes.js'
import { buildSDRContexto } from './sdrUtils.js'
import { ClasificacionExcelSchema, type ClasificacionExcel, type EntradaClasificacionExcel } from '../../types/dominio/Excel.js'
import { SupabaseTools } from '../../agents/mcp/SupabaseTools.js'
import { IntentGate } from './IntentGate.js'

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

// ── OCR helpers — barrera determinista sobre la respuesta del modelo ──────────

function validarReglasDominio(ocr: ResultadoOCR): string[] {
  const warnings: string[] = []
  for (const r of ocr.registros) {
    if (r.monto !== null && r.monto > 10_000) warnings.push(`fila ${r.fila}: monto ${r.monto} sospechosamente alto`)
    if (r.cantidad !== null && r.cantidad < 0) warnings.push(`fila ${r.fila}: cantidad negativa (${r.cantidad})`)
    if (r.trabajadores !== null && r.trabajadores > 500) warnings.push(`fila ${r.fila}: trabajadores ${r.trabajadores} fuera de rango`)
  }
  return warnings
}

function construirFallbackOCR(json: unknown, zodErrors: string | null): ResultadoOCR {
  const j = json as any ?? {}
  return {
    tipo_documento: j.tipo_documento ?? 'otro',
    fecha_documento: j.fecha_documento ?? null,
    registros: Array.isArray(j.registros) ? j.registros.map((r: any, idx: number) => ({
      fila: typeof r.fila === 'number' ? r.fila : idx + 1,
      lote_raw: r.lote_raw ?? null,
      lote_id: r.lote_id ?? null,
      actividad: r.actividad ?? null,
      producto: r.producto ?? null,
      cantidad: typeof r.cantidad === 'number' ? r.cantidad
        : typeof r.cantidad === 'string' ? (isNaN(Number(r.cantidad)) ? null : Number(r.cantidad))
        : null,
      unidad: r.unidad ?? null,
      trabajadores: typeof r.trabajadores === 'number' ? r.trabajadores
        : typeof r.trabajadores === 'string' ? (isNaN(Number(r.trabajadores)) ? null : Number(r.trabajadores))
        : null,
      monto: typeof r.monto === 'number' ? r.monto
        : typeof r.monto === 'string' ? (isNaN(parseFloat(r.monto.replace(/[^0-9.-]/g, ''))) ? null : parseFloat(r.monto.replace(/[^0-9.-]/g, '')))
        : null,
      fecha_raw: r.fecha_raw ?? null,
      notas: r.notas ?? null,
      ilegible: r.ilegible ?? true,
    })) : [],
    texto_completo_visible: j.texto_completo_visible ?? '',
    confianza_lectura: typeof j.confianza_lectura === 'number' ? j.confianza_lectura : 0,
    advertencia: [j.advertencia, zodErrors ? `requires_review: ${zodErrors}` : null].filter(Boolean).join(' | ') || 'requires_review',
  }
}

export class WasagroAIAgent implements IWasagroLLM {
  readonly #adapter: ILLMAdapter
  readonly #lf: Langfuse
  readonly #intentGate: IntentGate

  constructor(adapter: ILLMAdapter, lf?: Langfuse) {
    this.#adapter = adapter
    this.#lf = lf ?? langfuseDefault
    this.#intentGate = new IntentGate(adapter, lf)
  }

  async clasificarIntenciones(input: EntradaEvento, traceId: string): Promise<ResultadoIntentGate> {
    return this.#intentGate.clasificar(input, traceId)
  }

  async extraerEventos(input: EntradaEvento, traceId: string): Promise<ExtraccionMultiEvento> {
    const trace = this.#lf.trace({ id: traceId })

    let clasificacion: ResultadoClasificacion;

    if (input.tipos_forzados && input.tipos_forzados.length > 0) {
      clasificacion = { tipos_evento: input.tipos_forzados as any, confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else if (input.tipo_forzado) {
      clasificacion = { tipos_evento: [input.tipo_forzado as any], confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else {
      clasificacion = await this.#clasificar(input, traceId)
    }

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

    const tiposValidos = clasificacion.tipos_evento.filter(t => !['saludo', 'consulta', 'ambiguo'].includes(t));

    if (tiposValidos.length === 0) {
      return sinEvento('No pude identificar qué evento reportas. ¿Me lo explicas de otra forma?');
    }

  const tipoElegido = tiposValidos[0]!
  const eventoExtraido = await this.#extraerEspecializado(
    { ...clasificacion, tipos_evento: [tipoElegido] } as ResultadoClasificacion,
    tipoElegido,
      input,
      traceId,
    );

    return {
      eventos: [eventoExtraido],
      pregunta_sugerida: eventoExtraido.requiere_clarificacion ? (eventoExtraido as any).pregunta_sugerida : undefined,
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

  async describirImagenVisual(imageUrl: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'describir_imagen', model: 'wasagro-ai-agent' })
    try {
      const prompt = (await PromptManager.getPrompt('sp-03a-vision-describe.md', 'prompts/sp-03a-vision-describe.md', typeof traceId !== 'undefined' ? traceId : undefined))
      
      let intentos = 0
      let texto = ''
      let json: any
      let parsed: ReturnType<typeof DescripcionVisualSchema.safeParse> | null = null

      while (intentos < 2) {
        const errorFeedback = intentos > 0 ? `\n\nTu respuesta anterior falló la validación Zod: ${parsed?.error?.errors.map(e => e.message).join(', ')}. Por favor, corrige tu JSON.` : ''
        
        const isBase64DataUri = imageUrl.startsWith('data:')
        const imageOpciones = isBase64DataUri
          ? { imageBase64: imageUrl.split(',')[1] ?? imageUrl, imageMimeType: imageUrl.split(';')[0]?.replace('data:', '') ?? 'image/jpeg' }
          : { imageUrl }

        const textoRaw = await this.#adapter.generarTexto('Analiza esta imagen y descríbela objetivamente según tus instrucciones en JSON estricto.' + errorFeedback, {
          systemPrompt: prompt,
          responseFormat: 'json_object',
          ...imageOpciones,
          traceId,
          generationName: 'llamarLibre',
          modelClass: 'ultra',
        })

        texto = textoRaw.replace(/```json/g, '').replace(/```/g, '').trim()
        
        try { 
          json = JSON.parse(texto) 
          parsed = DescripcionVisualSchema.safeParse(json)
          if (parsed.success) break
          
          trace.event({ name: 'v2vk_vision_zod_error', level: 'WARNING', output: { error: parsed.error.errors } })
        } catch {
          trace.event({ name: 'v2vk_vision_parse_error', level: 'WARNING', output: { texto: texto.slice(0, 100) } })
        }
        intentos++
      }

      if (!parsed?.success) {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Vision Scanner falló la gobernanza Zod tras reintentos`)
      }

      generation.end({ output: json })
      
      // Convertir el JSON extraído a un string estructurado para el RAG y Diagnóstico
      if (json.es_imagen_agricola === false) return "Imagen no agrícola."
      
      return `Órganos: ${json.organos_visibles?.join(', ')}\nSíntomas físicos: ${json.descripcion_fisica_cruda}\nÁrea afectada: ${json.porcentaje_area_afectada}\nPlagas: ${json.presencia_plagas_visibles}`
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error describiendo imagen: ${String(err)}`, err)
    }
  }

  async diagnosticarSintomaV2VK(descripcionVisual: string, contextoRAG: string, input: EntradaEvento, traceId: string): Promise<DiagnosticoV2VK> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'diagnosticar_v2vk', model: 'wasagro-ai-agent', input: { descripcionVisual } })
    try {
      if (!contextoRAG || contextoRAG === 'Sin contexto agronómico disponible.') {
        trace.event({ name: 'v2vk_empty_rag', level: 'WARNING', input: { descripcionVisual } })
      }

      const prompt = injectarVariables((await PromptManager.getPrompt('sp-03b-diagnostico-v2vk.md', 'prompts/sp-03b-diagnostico-v2vk.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
        CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
        PAIS: input.pais ?? 'EC',
        DESCRIPCION_VISUAL: descripcionVisual,
        CONTEXTO_RAG: contextoRAG || 'Sin contexto agronómico disponible.',
      })
      
      const textoRaw = await this.#adapter.generarTexto(descripcionVisual, { 
        systemPrompt: prompt, 
        responseFormat: 'json_object', 
        traceId, 
        generationName: 'llamarLibre', 
        modelClass: 'reasoning' // Modelo analítico cruzando síntomas con RAG
      })
      
      const texto = textoRaw.replace(/```json/g, '').replace(/```/g, '').trim()
      
      let json: unknown
      try { json = JSON.parse(texto) } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `V2VK devolvió no-JSON: ${texto.slice(0, 100)}`)
      }
      
      const parsed = DiagnosticoV2VKSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Schema V2VK inválido: ${parsed.error.message}`)
      }
      
      generation.end({ output: parsed.data })
      return parsed.data
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error diagnosticando imagen V2VK: ${String(err)}`, err)
    }
  }

  async clasificarTipoImagen(base64: string, mimeType: string, traceId: string): Promise<import('./IWasagroLLM.js').TipoImagen> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'clasificar_imagen', model: 'wasagro-ai-agent' })
    try {
      const prompt = await PromptManager.getPrompt('sp-03c-clasificador-imagen.md', 'prompts/sp-03c-clasificador-imagen.md', traceId)
    const raw = await this.#adapter.generarTexto('Clasifica esta imagen.', {
      systemPrompt: prompt,
      responseFormat: 'json_object',
      imageBase64: base64,
      imageMimeType: mimeType,
      traceId,
      generationName: 'clasificar_imagen',
      modelClass: 'fast',
    })
      const json = JSON.parse(raw.replace(/```json|```/g, '').trim())
      const tipos = ['plaga_cultivo', 'documento_tabla', 'otro'] as const
      const tipo = tipos.includes(json.tipo) ? json.tipo : 'plaga_cultivo'
      generation.end({ output: { tipo, confianza: json.confianza } })
      return tipo
    } catch (err) {
      console.error('[WasagroAIAgent] Error clasificando imagen:', err)
      generation.end({ output: String(err), level: 'ERROR' })
      trace.event({ name: 'clasificar_imagen_error', level: 'ERROR', input: { error: String(err) } })
      return 'plaga_cultivo'
    }
  }

  async extraerDocumentoOCR(
    base64: string,
    mimeType: string,
    contexto: ContextoOCR,
    traceId: string,
  ): Promise<ResultadoOCR> {
    const MAX_OCR_RETRIES = 2
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'ocr_documento', model: 'wasagro-ocr-tier', input: { tipo_contexto: contexto.cultivo_principal } })

    const prompt = injectarVariables(
      await PromptManager.getPrompt('sp-03d-ocr-documento.md', 'prompts/sp-03d-ocr-documento.md', traceId),
      {
        FINCA_NOMBRE: contexto.finca_nombre ?? 'No especificada',
        CULTIVO_PRINCIPAL: contexto.cultivo_principal ?? 'No especificado',
        LISTA_LOTES: contexto.lista_lotes ?? 'No hay lotes registrados',
      },
    )

    let lastJson: unknown = null
    let lastZodErrors: string | null = null

    for (let attempt = 0; attempt <= MAX_OCR_RETRIES; attempt++) {
      // En intentos de corrección: feedback explícito + imagen nuevamente (adapters son stateless)
      const userContent = attempt === 0
        ? 'Extrae los datos de este documento agrícola.'
        : `Corrección requerida (intento ${attempt}/${MAX_OCR_RETRIES}). Tu respuesta anterior falló la validación de esquema. Errores específicos: ${lastZodErrors}. Devuelve el JSON COMPLETO corregido siguiendo estrictamente el esquema del system prompt.`

      try {
        const raw = await this.#adapter.generarTexto(userContent, {
          systemPrompt: prompt,
          responseFormat: 'json_object',
          imageBase64: base64,
          imageMimeType: mimeType,
          traceId,
          generationName: `ocr_documento_attempt_${attempt}`,
          modelClass: 'ocr',
        })

        const texto = raw.replace(/```json|```/g, '').trim()
        let json: unknown
        try { json = JSON.parse(texto) } catch {
          lastZodErrors = `JSON inválido: ${texto.slice(0, 120)}`
          trace.event({ name: 'ocr_parse_error', level: 'WARNING', input: { attempt, raw: texto.slice(0, 120) } })
          continue
        }

        lastJson = json
        const parsed = ResultadoOCRSchema.safeParse(json)

        if (parsed.success) {
          // Validación de reglas de negocio (capa determinista sobre Zod)
          const warnings = validarReglasDominio(parsed.data)
          if (warnings.length > 0) {
            trace.event({ name: 'ocr_business_rules_warning', level: 'WARNING', input: { warnings } })
            parsed.data.advertencia = [parsed.data.advertencia, warnings.join(' | ')].filter(Boolean).join(' | ')
          }
          generation.end({ output: { tipo_documento: parsed.data.tipo_documento, n_registros: parsed.data.registros.length, confianza: parsed.data.confianza_lectura, zod_valid: true, attempts: attempt + 1 } })
          return parsed.data
        }

        lastZodErrors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        trace.event({ name: 'ocr_zod_retry', level: 'WARNING', input: { attempt, errors: lastZodErrors } })

      } catch (err) {
        trace.event({ name: 'ocr_attempt_error', level: 'ERROR', input: { attempt, error: String(err) } })
        if (attempt === MAX_OCR_RETRIES) {
          generation.end({ output: String(err), level: 'ERROR' })
          throw new LLMError('GROQ_ERROR', `Error en OCR de documento tras ${MAX_OCR_RETRIES + 1} intentos: ${String(err)}`, err)
        }
      }
    }

    // Agotados los reintentos — fallback determinista con los datos que se pudieron rescatar
    trace.event({ name: 'ocr_zod_exhausted', level: 'ERROR', input: { final_errors: lastZodErrors } })
    const fallback = construirFallbackOCR(lastJson, lastZodErrors)
    generation.end({ output: { tipo_documento: fallback.tipo_documento, n_registros: fallback.registros.length, confianza: fallback.confianza_lectura, zod_valid: false, attempts: MAX_OCR_RETRIES + 1 } })
    return fallback
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

  async extraerDatosSDR(textoMensaje: string, contextoActual: string, traceId: string): Promise<ExtraccionSDR> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'extraer_datos_sdr',
      model: 'wasagro-ai-agent',
      input: { mensaje: textoMensaje },
    })

    const inicio = Date.now()
    try {
      const prompt = await PromptManager.getPrompt('SP-SDR-02-extractor.md', 'sdr/prompts/SP-SDR-02-extractor.md', traceId)
      const userContent = `Contexto Actual del Prospecto:\n${contextoActual}\n\nMensaje Actual: ${textoMensaje}`

      const texto = await this.#adapter.generarTexto(userContent, { 
        systemPrompt: prompt, 
        responseFormat: 'json_object', 
        traceId, 
        generationName: 'extraer_sdr',
        modelClass: 'fast', // Enrutamiento rápido
        temperature: 0
      })
      const latencia = Date.now() - inicio

      let json: unknown
      try {
        // Limpiar Markdown si existe
        const cleanText = texto.replace(/```json/g, '').replace(/```/g, '').trim()
        json = JSON.parse(cleanText)
      } catch {
        generation.end({ output: texto, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Extractor SDR devolvió respuesta no-JSON: ${texto.slice(0, 100)}`)
      }

      const parsed = ExtraccionSDRSchema.safeParse(json)
      if (!parsed.success) {
        generation.end({ output: json, level: 'ERROR' })
        throw new LLMError('PARSE_ERROR', `Extraccion SDR schema inválido: ${parsed.error.message}`)
      }

      generation.end({ output: parsed.data, metadata: { latencia_ms: latencia } })
      return parsed.data
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en Extractor SDR: ${String(err)}`, err)
    }
  }

  async redactarMensajeSDR(mensajeUsuario: string, contextoActual: string, directiva: string, traceId: string): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'redactar_mensaje_sdr',
      model: 'wasagro-ai-agent',
      input: { directiva },
    })

    try {
      const prompt = await PromptManager.getPrompt('SP-SDR-03-writer.md', 'sdr/prompts/SP-SDR-03-writer.md', traceId)
      const userContent = `Contexto del Prospecto:\n${contextoActual}\n\nÚltimo mensaje del usuario: "${mensajeUsuario}"\n\n=== DIRECTIVA OBLIGATORIA ===\n${directiva}`

      const texto = await this.#adapter.generarTexto(userContent, { 
        systemPrompt: prompt, 
        responseFormat: 'text', 
        traceId, 
        generationName: 'redactar_sdr',
        modelClass: 'fast',
      })

      generation.end({ output: texto })
      return texto.trim()
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en Redactor SDR: ${String(err)}`, err)
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
      const textoRaw = await this.#adapter.generarTexto(input.transcripcion, { 
        systemPrompt: prompt, 
        responseFormat: 'json_object', 
        traceId, 
        generationName: 'llamar',
        modelClass: 'fast', // Enrutamiento ultra-rápido (Flash)
        temperature: 0 // CRÍTICO: 0 para clasificación determinista
      })
      
      // Limpiar Markdown si existe
      const texto = textoRaw.replace(/```json/g, '').replace(/```/g, '').trim()
      
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
    const fechaHoy = new Date().toISOString().slice(0, 10)

    const systemPrompt = injectarVariables((await PromptManager.getPrompt(promptFile, `prompts/${promptFile}`, typeof traceId !== 'undefined' ? traceId : undefined)), {
      LISTA_LOTES: input.lista_lotes ?? 'No hay lotes registrados', // Fallback por ahora hasta limpar prompts
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      PAIS: input.pais ?? 'EC',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
      CONTEXTO_HISTORICO: input.contexto_rag ?? '',
      ESTADO_PARCIAL: estadoParcialJSON,
      FECHA_HOY: fechaHoy,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: `extraer_${tipo_evento}`,
      model: 'wasagro-ai-agent',
      input: { transcripcion: input.transcripcion, tipo: tipo_evento },
    })

    const inicio = Date.now()
    let conversationHistory = `Transcripción: ${input.transcripcion}`
    let iterations = 0
    const maxIterations = 3 // Guardrail: Límite estricto de iteraciones
    const toolCallHistory = new Set<string>() // Guardrail: Detección de Doom-Loops

    while (iterations < maxIterations) {
      try {
        const textoRaw = await this.#adapter.generarTexto(conversationHistory, { 
          systemPrompt, 
          responseFormat: 'json_object', 
          traceId, 
          generationName: `llamar_react_iter_${iterations}`,
          modelClass: 'reasoning',
          tools: SupabaseTools
        })

        // Limpiar Markdown si el LLM envolvió la respuesta
        const texto = textoRaw.replace(/```json/g, '').replace(/```/g, '').trim()

        let json: any
        try { json = JSON.parse(texto) } catch {
          generation.end({ output: texto, level: 'ERROR' })
          throw new LLMError('PARSE_ERROR', `Extractor devolvió no-JSON: ${texto.slice(0, 100)}`)
        }

        // Detectar si el LLM invocó una herramienta (MCP Tool Call)
        if (json.__tool_call) {
          const { name, args } = json.__tool_call
          const toolCallHash = `${name}(${JSON.stringify(args)})`

          trace.event({ name: 'mcp_tool_call', input: { name, args } })
          console.log(`[MCP] 🛠️  Agente invocó herramienta: ${name}`, args)

          if (toolCallHistory.has(toolCallHash)) {
            console.warn(`[MCP] ⚠️ Doom-loop detectado para ${toolCallHash}. Abortando herramienta y forzando extracción.`)
            conversationHistory += `\n\n[Sistema]: Has llamado repetidamente a ${name} con los mismos argumentos sin éxito. DEBES abortar la búsqueda y generar la extracción JSON final usando la información que ya tienes. Si falta información crucial, marca requiere_clarificacion=true y añade una pregunta_sugerida.`
            iterations++
            continue
          }
          toolCallHistory.add(toolCallHash)

          const tool = SupabaseTools.find(t => t.name === name)
          let toolResultStr = ''
          
          if (!tool) {
            toolResultStr = `Error: Herramienta '${name}' no existe.`
          } else {
            try {
              // Inyectamos automáticamente el finca_id por seguridad, aunque el modelo deba pasarlo
              const safeArgs = { ...args, finca_id: input.finca_id }
              const result = await tool.execute(safeArgs)
              toolResultStr = JSON.stringify(result, null, 2)
            } catch (toolErr: any) {
              // Smart Nudge: Devolver el error al LLM en lugar de fallar
              toolResultStr = `Error ejecutando herramienta: ${toolErr.message}`
            }
          }

          // Agregamos la respuesta al contexto y volvemos a iterar
          conversationHistory += `\n\n[Resultado Herramienta ${name}]:\n${toolResultStr}\n\n[Sistema]: Analiza este resultado y decide si necesitas llamar otra herramienta o generar el JSON final de extracción.`
          iterations++
          continue
        }

        // Si no es un tool call, intentamos parsear el resultado final (Gobernanza Zod)
        const parsed = EventoCampoExtraidoSchema.safeParse(json)
        if (!parsed.success) {
          // Bucle de auto-corrección de Zod integrado en ReAct
          const erroresHarness = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
          console.warn(`[Harness] Gobernanza Zod falló en ${tipo_evento}:`, erroresHarness)
          
          if (iterations >= maxIterations - 1) {
            generation.end({ output: json, level: 'ERROR' })
            throw new LLMError('PARSE_ERROR', `Gobernanza Zod rechazó el output tras intentos: ${erroresHarness}`)
          }
          
          conversationHistory += `\n\n[Sistema]: Tu respuesta JSON anterior falló la validación estricta Zod: ${erroresHarness}. Por favor corrige la estructura y responde ÚNICAMENTE con el JSON válido.`
          iterations++
          continue
        }

        const latencia = Date.now() - inicio
        generation.end({ output: parsed.data, metadata: { latencia_ms: latencia, react_iterations: iterations + 1 } })
        return parsed.data

      } catch (err) {
        if (err instanceof LLMError) throw err
        generation.end({ output: String(err), level: 'ERROR' })
        throw new LLMError('GROQ_ERROR', `Error extrayendo ${tipo_evento}: ${String(err)}`, err)
      }
    }

    throw new LLMError('REACT_ERROR', `Se alcanzó el límite máximo de iteraciones (${maxIterations}) sin convergencia en la extracción.`)
  }

  
}
