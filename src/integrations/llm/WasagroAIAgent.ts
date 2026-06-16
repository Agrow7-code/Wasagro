import sharp from 'sharp'
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
import { ResumenSemanalSchema, type ResumenSemanal, type EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import { DescripcionVisualSchema, DiagnosticoV2VKSchema, type DiagnosticoV2VK } from '../../types/dominio/Vision.js'
import { ResultadoOCRSchema, type ResultadoOCR } from '../../types/dominio/OCR.js'
import { SigatokaMuestreoSchema, AclaracionSigatokaSchema, type SigatokaMuestreo, type AclaracionCelda } from '../../types/dominio/SigatokaMuestreo.js'
import { aplicarFiltroConfianza } from './confidenceFilter.js'
import { CalidadSigatokaSchema, CALIDAD_FALLBACK_PASA, type CalidadSigatoka } from '../../types/dominio/CalidadSigatoka.js'
import { calcularColumna, detectarCamposDudosos, construirFallbackSigatoka, normalizarPunto, normalizarFilaSemana, verificarChecksumTabla, filasConDato, elegirMejorTabla, reconciliarCrossField, elegirMejorDatos, type ResultadoTabla } from '../../pipeline/handlers/SigatokaHandler.js'
import type { ContextoOCR } from './IWasagroLLM.js'
import { injectarVariables } from '../../pipeline/promptInjector.js'
import { ExtraccionSDRSchema, type EntradaSDR, type ExtraccionSDR } from '../../types/dominio/SDRTypes.js'
import { buildSDRContexto } from './sdrUtils.js'
import { ClasificacionExcelSchema, type ClasificacionExcel, type EntradaClasificacionExcel } from '../../types/dominio/Excel.js'
import { SupabaseTools } from '../../agents/mcp/SupabaseTools.js'
import { IntentGate } from './IntentGate.js'
import type { CostContext } from './IWasagroLLM.js'
import { runTypedClassifier } from './runTypedClassifier.js'

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

// Fase F fallback: si el LLM no devuelve JSON valido en dos intentos, devolver
// este shape al handler. No avanza el onboarding (paso_completado y siguiente_paso
// quedan en 0 → el handler no persiste finca/usuario incompleto) y pide al usuario
// reintentar con un mensaje neutro. La mejora UX real es contextual del LLM —
// este fallback es solo la red de seguridad cuando ambos intentos fallan.
const ONBOARDING_FALLBACK: RespuestaOnboarding = {
  paso_completado: 0,
  siguiente_paso:  0,
  datos_extraidos: {},
  mensaje_para_usuario: 'Disculpá, no terminé de procesar tu mensaje. ¿Me lo podés repetir?',
  onboarding_completo: false,
}

import type { ILLMAdapter, LLMGeneracionOpciones } from './ILLMAdapter.js'

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

  #costOpts(costCtx?: CostContext): Pick<LLMGeneracionOpciones, 'orgId' | 'fincaId'> {
    if (!costCtx) return {}
    const out: Record<string, string> = {}
    if (costCtx.orgId) out['orgId'] = costCtx.orgId
    if (costCtx.fincaId) out['fincaId'] = costCtx.fincaId
    return out as Pick<LLMGeneracionOpciones, 'orgId' | 'fincaId'>
  }

  async clasificarIntenciones(input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<ResultadoIntentGate> {
    return this.#intentGate.clasificar(input, traceId, costCtx)
  }

  async extraerEventos(input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<ExtraccionMultiEvento> {
    const trace = this.#lf.trace({ id: traceId })

    let clasificacion: ResultadoClasificacion;

    if (input.tipos_forzados && input.tipos_forzados.length > 0) {
      clasificacion = { tipos_evento: input.tipos_forzados as any, confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else if (input.tipo_forzado) {
      clasificacion = { tipos_evento: [input.tipo_forzado as any], confidence: 1, requiere_imagen_para_confirmar: false, motivo_ambiguo: null, mensaje_clarificacion: null }
    } else {
      clasificacion = await this.#clasificar(input, traceId, costCtx)
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
      costCtx,
    );

    return {
      eventos: [eventoExtraido],
      pregunta_sugerida: eventoExtraido.requiere_clarificacion ? (eventoExtraido as any).pregunta_sugerida : undefined,
    }
  }

  async corregirTranscripcion(raw: string, traceId: string, costCtx?: CostContext): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const promptName = 'sp-02-post-correccion-stt.md'
    const prompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)
    const genOpts: Record<string, unknown> = { name: 'corregir_transcripcion', model: 'wasagro/orchestrator', input: { raw } }
    const pc = PromptManager.getPromptClient(promptName)
    if (pc) genOpts['prompt'] = pc
    const generation = trace.generation(genOpts as any)
    try {
      const corrected = await this.#adapter.generarTexto(`Transcripción: ${raw}`, { systemPrompt: prompt, responseFormat: 'text', temperature: 0, traceId, generationName: 'stt_post_correction', ...this.#costOpts(costCtx) })
      generation.end({ output: corrected })
      return corrected.trim()
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error corrigiendo transcripción: ${String(err)}`, err)
    }
  }

  async describirImagenVisual(imageUrl: string, traceId: string, costCtx?: CostContext): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const promptName = 'sp-03a-vision-describe.md'
    const prompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)
    const genOpts: Record<string, unknown> = { name: 'describir_imagen', model: 'wasagro/orchestrator' }
    const pc = PromptManager.getPromptClient(promptName)
    if (pc) genOpts['prompt'] = pc
    const generation = trace.generation(genOpts as any)
    try {
      
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
          temperature: 0,
          ...imageOpciones,
          traceId,
          generationName: `vision_describe_attempt_${intentos + 1}`,
          modelClass: 'ultra',
          ...this.#costOpts(costCtx),
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

  async diagnosticarSintomaV2VK(descripcionVisual: string, contextoRAG: string, input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<DiagnosticoV2VK> {
    const trace = this.#lf.trace({ id: traceId })
    const promptName = 'sp-03b-diagnostico-v2vk.md'
    const rawPrompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)
    const genOpts: Record<string, unknown> = { name: 'diagnosticar_v2vk', model: 'wasagro/orchestrator', input: { descripcionVisual } }
    const pc = PromptManager.getPromptClient(promptName)
    if (pc) genOpts['prompt'] = pc
    const generation = trace.generation(genOpts as any)
    try {
      if (!contextoRAG || contextoRAG === 'Sin contexto agronómico disponible.') {
        trace.event({ name: 'v2vk_empty_rag', level: 'WARNING', input: { descripcionVisual } })
      }

      const prompt = injectarVariables(rawPrompt, {
        FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
        CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
        PAIS: input.pais ?? 'EC',
        DESCRIPCION_VISUAL: descripcionVisual,
        CONTEXTO_RAG: contextoRAG || 'Sin contexto agronómico disponible.',
      })
      
      const textoRaw = await this.#adapter.generarTexto(descripcionVisual, {
        systemPrompt: prompt,
        responseFormat: 'json_object',
        temperature: 0,
        traceId,
        generationName: 'v2vk_diagnose',
        modelClass: 'reasoning',
        ...this.#costOpts(costCtx),
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

  async clasificarTipoImagen(base64: string, mimeType: string, traceId: string, caption?: string, costCtx?: CostContext): Promise<import('./IWasagroLLM.js').TipoImagen> {
    const imgPromptName = 'sp-03c-clasificador-imagen.md'
    const promptRaw = await PromptManager.getPrompt(imgPromptName, `prompts/${imgPromptName}`, traceId)
    const prompt = promptRaw.replace(
      '{{CAPTION}}',
      caption ? `El agricultor escribió junto con la imagen: "${caption}"` : 'El agricultor no escribió texto junto con la imagen.',
    )

    const ClasificarImagenSchema = z.object({
      tipo: z.enum(['plaga_cultivo', 'documento_tabla', 'muestreo_sigatoka_banano', 'otro']),
      confianza: z.number().min(0).max(1).optional(),
    })

    const result = await runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent: 'Clasifica esta imagen.',
      schema: ClasificarImagenSchema,
      traceId,
      classifierName: 'clasificar_imagen',
      fallback: { tipo: 'otro' as const },
      modelClass: 'fast',
      temperature: 0,
      imageBase64: base64,
      imageMimeType: mimeType,
      langfuseClient: this.#lf,
      generationInput: { caption: caption ?? null },
      promptClient: PromptManager.getPromptClient(imgPromptName),
      ...this.#costOpts(costCtx),
    })
    return result.tipo
  }

  // Detector binario enfocado de ficha Sigatoka. Existe porque el clasificador
  // multiopción (sp-03c) ancla en `documento_tabla` con fichas Dole/LOGBAN: con
  // 4 opciones y una imagen dominada por una tabla densa, el modelo ignora el
  // título impreso. Una sola pregunta sí/no (sp-03g) SÍ lee el título de forma
  // fiable con el mismo modelo. Se corre en paralelo a clasificarTipoImagen y
  // su `true` gana. Fallback = false: nunca fuerza la ruta Sigatoka por error.
  async detectarFichaSigatoka(base64: string, mimeType: string, traceId: string, costCtx?: CostContext): Promise<boolean> {
    const promptName = 'sp-03g-detector-sigatoka.md'
    const prompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)

    const DetectarSigatokaSchema = z.object({
      es_sigatoka: z.boolean(),
      titulo_leido: z.string().nullable().optional(),
    })

    const result = await runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent: '¿Es un formulario de muestreo de Sigatoka?',
      schema: DetectarSigatokaSchema,
      traceId,
      classifierName: 'detectar_ficha_sigatoka',
      fallback: { es_sigatoka: false },
      modelClass: 'fast',
      temperature: 0,
      imageBase64: base64,
      imageMimeType: mimeType,
      langfuseClient: this.#lf,
      promptClient: PromptManager.getPromptClient(promptName),
      ...this.#costOpts(costCtx),
    })
    return result.es_sigatoka
  }

  // Pase de calidad liviano (tier fast) ANTES de la extracción pesada de
  // Sigatoka. Decide cortada/borrosa/legible. Si el gate mismo falla, el
  // fallback DEJA PASAR — nunca bloqueamos por una falla del control.
  async evaluarCalidadFichaSigatoka(base64: string, mimeType: string, traceId: string, costCtx?: CostContext): Promise<CalidadSigatoka> {
    const promptName = 'sp-03f-calidad-sigatoka.md'
    const prompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)

    return runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent: 'Evalúa la calidad de esta foto de formulario de Sigatoka.',
      schema: CalidadSigatokaSchema,
      traceId,
      classifierName: 'calidad_ficha_sigatoka',
      fallback: CALIDAD_FALLBACK_PASA,
      modelClass: 'fast',
      temperature: 0,
      imageBase64: base64,
      imageMimeType: mimeType,
      langfuseClient: this.#lf,
      generationInput: { formulario: 'muestreo_sigatoka_banano' },
      promptClient: PromptManager.getPromptClient(promptName),
      ...this.#costOpts(costCtx),
    })
  }

  // Interpreta la respuesta de texto del tomador a las celdas ilegibles. Tier
  // fast (parseo simple). Si falla, devuelve [] (sin aclaraciones → las celdas
  // siguen ilegibles, el evento queda para el asesor; nunca inventamos).
  async interpretarAclaracionSigatoka(
    respuestaUsuario: string,
    ubicaciones: Array<{ punto: string; campo: string }>,
    traceId: string,
    costCtx?: CostContext,
  ): Promise<AclaracionCelda[]> {
    const promptName = 'sp-03h-aclaracion-sigatoka.md'
    const prompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)

    const userContent = `Celdas ilegibles:\n${JSON.stringify(ubicaciones)}\n\nRespuesta del agricultor:\n"${respuestaUsuario}"`

    const result = await runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent,
      schema: AclaracionSigatokaSchema,
      traceId,
      classifierName: 'aclaracion_sigatoka',
      fallback: { aclaraciones: [] },
      modelClass: 'fast',
      temperature: 0,
      langfuseClient: this.#lf,
      promptClient: PromptManager.getPromptClient(promptName),
      ...this.#costOpts(costCtx),
    })
    return result.aclaraciones
  }

  async extraerDocumentoOCR(
    base64: string,
    mimeType: string,
    contexto: ContextoOCR,
    traceId: string,
    costCtx?: CostContext,
  ): Promise<ResultadoOCR> {
    const MAX_OCR_RETRIES = 2
    const trace = this.#lf.trace({ id: traceId })
    const ocrPromptName = 'sp-03d-ocr-documento.md'
    const rawOcrPrompt = await PromptManager.getPrompt(ocrPromptName, `prompts/${ocrPromptName}`, traceId)
    const ocrGenOpts: Record<string, unknown> = { name: 'ocr_documento', model: 'wasagro-ocr-tier', input: { tipo_contexto: contexto.cultivo_principal } }
    const ocrPc = PromptManager.getPromptClient(ocrPromptName)
    if (ocrPc) ocrGenOpts['prompt'] = ocrPc
    const generation = trace.generation(ocrGenOpts as any)

    const prompt = injectarVariables(
      rawOcrPrompt,
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
        temperature: 0,
        imageBase64: base64,
        imageMimeType: mimeType,
        traceId,
        generationName: `ocr_documento_attempt_${attempt}`,
        modelClass: 'ocr',
        // El OCR de tablas densas con Gemini puede pasar el default de 20s del
        // router. Sin margen, se corta y reintenta 3 veces (~76s). Con 35s
        // completa en el primer intento (~30s) y no apila reintentos.
        timeoutMs: 35_000,
        ...this.#costOpts(costCtx),
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

  // Extracción en CUATRO PASADAS PARALELAS: la ficha es demasiado densa para una
  // sola llamada de visión (el modelo suelta secciones de forma no-determinista).
  // Cada pasada enfoca una zona acotada → captura confiable; luego se mergea.
  //   e1)  izquierda: encabezado + matriz P1..P19 + DATOS A..M
  //   e2a) tabla 11 semanas (filas + T=/Pr=)
  //   e2b) tabla 00 semanas (filas + T=/Pr=)
  //   e3)  plagas: EF + plagas foliares + diferidos
  // Van en paralelo → la latencia es ~la de una sola llamada. [ADR 016/017]
  // Tras el merge, se verifica checksum T= vs suma de filas. Si no cuadra,
  // se re-extrae esa tabla UNA sola vez con un hint correctivo. [ADR 017]
  async extraerMuestreoSigatoka(
    base64: string,
    mimeType: string,
    traceId: string,
    costCtx?: CostContext,
  ): Promise<SigatokaMuestreo> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({ name: 'sigatoka_extraction', model: 'wasagro-ocr-tier', input: { formulario: 'muestreo_sigatoka_banano', modo: 'cuatro_pasadas' } } as any)

    // Cap duro por pasada: si el router se cuelga reintentando proveedores, una
    // pasada NO debe arrastrar la latencia total. A los 45s la damos por fallida
    // (null) → esa sección queda para revisión, pero el SLA P3 se respeta.
    const conCap = <T>(p: Promise<T>): Promise<T | null> => {
      let t: ReturnType<typeof setTimeout>
      const cap = new Promise<null>(res => { t = setTimeout(() => res(null), 45_000) })
      return Promise.race([p.finally(() => clearTimeout(t)), cap])
    }
    const PASADAS: Array<[string, string]> = [
      ['sp-03e1-sigatoka-izquierda.md',  'Extrae SOLO la mitad izquierda: encabezado, matriz de puntos P1..P19 y bloque DATOS A..M.'],
      ['sp-03e2a-sigatoka-11sem.md',      'Extrae SOLO la tabla PLANTAS DE 11 SEMANAS con sus filas y totales T=/Pr=.'],
      ['sp-03e2b-sigatoka-00sem.md',      'Extrae SOLO la tabla PLANTAS DE 00 SEMANAS con sus filas y totales T=/Pr=.'],
      ['sp-03e3-sigatoka-plagas.md',      'Extrae SOLO la tabla EF, las PLAGAS FOLIARES (Ceramida/Sibine) y los diferidos (P-EF-FINCA, erradicadas por BSV).'],
    ]
    const correr = (i: number) => conCap(this.#extraerParteSigatoka(PASADAS[i]![0], PASADAS[i]![1], base64, mimeType, traceId, costCtx))

    // Regiones de recorte (fracciones de la imagen completa). Generosas para tolerar
    // desencuadres de foto; el full-frame es siempre el respaldo (elegirMejorTabla).
    // Validado empíricamente: crop+zoom 3× pasa de ~14 a ~18 filas leídas en e2b.
    // zoom 4× (validado: más zoom resuelve misreads de dígito); regiones generosas
    // para que el zoom no corte la fila T= ni filas del borde (se afina con fichas).
    const REGION_11SEM = { left: 0.53, top: 0.08, width: 0.47, height: 0.40, zoom: 4 }
    const REGION_00SEM = { left: 0.53, top: 0.44, width: 0.47, height: 0.42, zoom: 4 }
    // Bloque DATOS (A..M, 3 columnas) abajo-izquierda: el modelo suelta decimales y
    // confunde conteos en la foto completa (D=2916 ← el "29.16" de la fila I). Recorte
    // ampliado con las 3 columnas + rótulos A..M.
    const REGION_DATOS = { left: 0.0, top: 0.50, width: 0.66, height: 0.30, zoom: 4 }

    // Recorta, luego corre la pasada i sobre la imagen recortada.
    // Si el recorte falla (sharp error o imagen no válida) devuelve null directamente
    // sin consumir una llamada LLM → el full-frame queda como único resultado.
    const correrCrop = async (i: number, region: typeof REGION_11SEM) => {
      const cropBase64 = await this.#recortarRegion(base64, region, traceId)
      if (!cropBase64) return null
      return conCap(this.#extraerParteSigatoka(PASADAS[i]![0], PASADAS[i]![1], cropBase64, mimeType, traceId, costCtx))
    }

    let [izqRaw, tab11Raw, tab00Raw, plgRaw] = await Promise.all([
      correr(0), correr(1), correr(2), correr(3),
    ])

    // Reintento ÚNICO de las pasadas que fallaron (hiccup transitorio del proveedor).
    // Solo re-corre las nulas, en paralelo → no penaliza el caso OK y recupera
    // la data crítica (izquierda) cuando hubo un timeout suelto.
    if (!izqRaw || !tab11Raw || !tab00Raw || !plgRaw) {
      trace.event({ name: 'sigatoka_pasada_reintento', level: 'WARNING', input: { izq: !izqRaw, tab11: !tab11Raw, tab00: !tab00Raw, plg: !plgRaw } })
      const [r0, r1, r2, r3] = await Promise.all([
        izqRaw   ?? correr(0),
        tab11Raw ?? correr(1),
        tab00Raw ?? correr(2),
        plgRaw   ?? correr(3),
      ])
      izqRaw = r0; tab11Raw = r1; tab00Raw = r2; plgRaw = r3
    }

    const izq:   any = izqRaw   ?? {}
    const t11:   any = tab11Raw ?? {}
    const t00:   any = tab00Raw ?? {}
    const plg:   any = plgRaw   ?? {}

    // e2a/e2b emiten { filas, totales, promedios }; normalizar cada fila a CeldaMuestra.
    const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])

    // ─── Crop perezoso (lazy) + fallback full-frame (ADR 017 §Crop-assisted) ──
    // Arrancamos SIEMPRE con el full-frame. Solo si el checksum de una tabla NO
    // cuadra recurrimos al crop+zoom (más resolución → recupera filas tenues) y,
    // recién si aún no cuadra, al hint. Así el caso común corre 4 pasadas, no 6:
    // el crop se gasta solo cuando hace falta, sin presionar el rate-limit.
    const toResultadoTabla = (raw: any | null): ResultadoTabla | null => {
      if (!raw) return null
      return {
        filas: arr(raw.filas).map(normalizarFilaSemana),
        totales: raw.totales ?? null,
        promedios: raw.promedios ?? null,
      }
    }
    const TABLA_VACIA: ResultadoTabla = { filas: [], totales: null, promedios: null }
    const full11 = toResultadoTabla(tab11Raw) ?? TABLA_VACIA
    const full00 = toResultadoTabla(tab00Raw) ?? TABLA_VACIA

    const reExtaerConHint = async (promptIdx: number, totales: any, promedios: any, filas: any[], prefijo: string): Promise<{ filas: any[]; totales: any; promedios: any } | null> => {
      // Construir hint por columna que no cuadra
      const ver = verificarChecksumTabla(filas, totales)
      const noOK = ver.columnas.filter(c => c.cuadra === false)
      if (noOK.length === 0) return null // ya cuadra, no re-extraer

      // Diagnóstico del error por columna: suma < total ⇒ faltan filas; suma > total
      // ⇒ se duplicaron/leyeron de más; ≈ ⇒ valores mal leídos. Saber la dirección
      // hace el reintento mucho más útil que un "no cuadra" genérico.
      const hints = noOK.map(c => {
        const t = c.totalFicha ?? 0
        const dir = c.sumaFilas < t ? 'te FALTAN filas (tu suma es MENOR que el total)'
                  : c.sumaFilas > t ? 'leíste filas de más o duplicaste (tu suma es MAYOR)'
                  : 'hay valores mal leídos'
        return `columna ${c.columna}: tu suma ${c.sumaFilas} vs ficha T=${c.totalFicha} → ${dir}`
      }).join('; ')

      // Estimar cuántas filas debería tener la tabla: total ÷ promedio (Pr) de la
      // ficha, tomando el máximo entre columnas. Si leímos menos, son filas tenues
      // que se saltaron. Solo lo afirmamos en un rango razonable (no si Pr da algo
      // disparatado por mal-lectura del promedio).
      const filasLeidas = filas.length
      let filasEsperadas = 0
      for (const c of noOK) {
        const pr = promedios?.[c.columna]
        if (typeof pr === 'number' && pr > 0 && c.totalFicha != null) {
          filasEsperadas = Math.max(filasEsperadas, Math.round(c.totalFicha / pr))
        }
      }
      const conteo = filasEsperadas > filasLeidas && filasEsperadas <= filasLeidas + 12
        ? ` Esta tabla tiene ~${filasEsperadas} filas (total ÷ promedio Pr) pero leíste solo ${filasLeidas}: te faltan ~${filasEsperadas - filasLeidas} filas, probablemente tenues o apretadas. Encontralas y leélas TODAS, de arriba a abajo.`
        : ''

      const hint = `VERIFICACIÓN: ${hints}.${conteo} Releé la tabla ${prefijo} fila por fila, sin inventar ni duplicar valores.`
      const extra = PASADAS[promptIdx]!
      const reRaw = await conCap(this.#extraerParteSigatoka(extra[0], `${extra[1]}\n\n${hint}`, base64, mimeType, traceId, costCtx))
      if (!reRaw) return null
      const r: any = reRaw
      return { filas: arr(r.filas).map(normalizarFilaSemana), totales: r.totales ?? null, promedios: r.promedios ?? null }
    }

    // Recovery perezoso de una tabla cuyo checksum no cuadra. Solo gasta llamadas
    // extra cuando hace falta: 1) crop+zoom (más resolución → recupera filas
    // tenues que el full no leyó); 2) si AÚN no cuadra, hint sobre el full
    // (valores mal leídos). El crop es mejor "retry" que releer el full porque
    // tiene más resolución, por eso va primero.
    const recuperarTabla = async (
      idx: number, region: typeof REGION_11SEM, prefijo: '11 semanas' | '00 semanas',
      tag: '11sem' | '00sem', full: ResultadoTabla,
    ): Promise<ResultadoTabla> => {
      // El T= de la ficha (full-frame) es la referencia autoritativa del checksum.
      // El crop puede no capturar la fila T= → siempre verificamos contra totalesRef.
      if (!full.totales) return full
      const totalesRef = full.totales
      if (verificarChecksumTabla(full.filas, totalesRef).cuadraTodo !== false) return full

      let elegida = full
      trace.event({ name: `sigatoka_checksum_fallo_${tag}`, level: 'WARNING', input: { filas: full.filas.length } })

      // 1) Crop+zoom de ESTA tabla.
      const cropR = toResultadoTabla(await correrCrop(idx, region))
      if (cropR) {
        const mejor = elegirMejorTabla(elegida, cropR, totalesRef) ?? elegida
        trace.event({ name: 'sigatoka_crop_elegido', level: 'DEFAULT', input: { tabla: tag, fuente: mejor === cropR ? 'crop' : 'full', filas_full: full.filas.length, filas_crop: cropR.filas.length } })
        elegida = mejor
      }

      // 2) Reconciliación cross-field (Etapa A, gratis): corrige celdas donde una
      // columna contradice a su correlato (H.T vs Q>5%), solo si hace cuadrar el T=.
      const recon = reconciliarCrossField(elegida.filas, totalesRef)
      if (recon.corregidas.length > 0) {
        elegida = { ...elegida, filas: recon.filas }
        trace.event({ name: `sigatoka_crossfield_${tag}`, level: 'DEFAULT', input: { corregidas: recon.corregidas } })
      }

      // 3) Hint sobre el full si todavía no cuadra.
      const verA = verificarChecksumTabla(elegida.filas, totalesRef)
      if (verA.cuadraTodo === false) {
        const retry = await reExtaerConHint(idx, totalesRef, elegida.promedios, elegida.filas, prefijo)
        if (retry) {
          const verB = verificarChecksumTabla(retry.filas, totalesRef)
          const original = verA.columnas.filter(c => c.cuadra === true).length
          const nuevo = verB.columnas.filter(c => c.cuadra === true).length
          if (nuevo > original || (nuevo === original && filasConDato(retry.filas) > filasConDato(elegida.filas))) {
            elegida = { filas: retry.filas, totales: totalesRef, promedios: retry.promedios ?? elegida.promedios }
            trace.event({ name: `sigatoka_checksum_mejoro_${tag}`, level: 'DEFAULT', input: { original, nuevo } })
          } else {
            // P4: el reintento que empeora también queda trazado (se descarta).
            trace.event({ name: `sigatoka_checksum_no_mejoro_${tag}`, level: 'WARNING', input: { original, nuevo } })
          }
        }
      }
      // Persistir el T= de la ficha como total de la tabla (no el del crop, que
      // puede haber quedado null si el recorte no incluyó la fila T=).
      return { filas: elegida.filas, totales: totalesRef, promedios: elegida.promedios ?? full.promedios }
    }

    // Secuencial (no paralelo): cuando ambas tablas fallan, evita disparar dos
    // crops concurrentes y volver a presionar el rate-limit.
    const elegida11 = await recuperarTabla(1, REGION_11SEM, '11 semanas', '11sem', full11)
    const elegida00 = await recuperarTabla(2, REGION_00SEM, '00 semanas', '00sem', full00)

    const filas11Final = elegida11.filas
    const totales11Final = elegida11.totales
    const promedios11Final = elegida11.promedios
    const filas00Final = elegida00.filas
    const totales00Final = elegida00.totales
    const promedios00Final = elegida00.promedios

    // Verificación final para persistir en datos_evento
    const ver11Final = totales11Final ? verificarChecksumTabla(filas11Final, totales11Final) : null
    const ver00Final = totales00Final ? verificarChecksumTabla(filas00Final, totales00Final) : null

    const PLAGAS_VACIAS = { ceramida: { h: null, p: null, m: null, g: null }, sibine: { h: null, p: null, m: null, g: null } }
    const merged: any = {
      zona: izq.zona ?? null, codigoFinca: izq.codigoFinca ?? null, nombreFinca: izq.nombreFinca ?? null,
      semana: izq.semana ?? null, periodo: izq.periodo ?? null, fecha: izq.fecha ?? null, supervisor: izq.supervisor ?? null,
      puntosMuestreo: (izq.puntosMuestreo ?? []).map(normalizarPunto),
      resumenColumnas: (izq.resumenColumnas ?? []).map(calcularColumna),
      plantas:         plg.plantas ?? [],
      plantas11sem:    filas11Final,
      plantas00sem:    filas00Final,
      totales11sem:    totales11Final,
      promedios11sem:  promedios11Final,
      totales00sem:    totales00Final,
      promedios00sem:  promedios00Final,
      verificacion11sem: ver11Final,
      verificacion00sem: ver00Final,
      plagasFoliares:  plg.plagasFoliares ?? PLAGAS_VACIAS,
      pEfFinca:        plg.pEfFinca    ?? null,
      pEfFincaT:       plg.pEfFincaT   ?? null,
      pEfFincaFrec:    plg.pEfFincaFrec ?? null,
      erradicadasBsv:  plg.erradicadasBsv ?? null,
      // Confianza = la PEOR pasada. Cualquiera que falló (null) cuenta 0 → fuerza
      // requires_review para que el asesor complete lo que faltó en la UI (D30).
      confidenceScore: Math.min(
        izqRaw   ? (izq.confidenceScore ?? 0.6) : 0,
        tab11Raw ? (t11.confidenceScore ?? 0.6) : 0,
        tab00Raw ? (t00.confidenceScore ?? 0.6) : 0,
        plgRaw   ? (plg.confidenceScore ?? 0.6) : 0,
      ),
    }

    // Recovery DATOS (lazy): el bloque A..M se lee mal en la foto completa en algunas
    // fincas (decimales caídos: 37.5→375; conteos confundidos con el % de la fila de
    // abajo: D=2916 ← "29.16"). Si hay discrepancias calc-vs-formulario, re-leemos DATOS
    // de un recorte ampliado+preprocesado y nos quedamos con la lectura más consistente.
    // Solo gasta una llamada cuando hace falta (mismo patrón que el crop de tablas).
    if (detectarCamposDudosos(merged.resumenColumnas).length > 0) {
      const cropDatos = await this.#recortarRegion(base64, REGION_DATOS, traceId)
      if (cropDatos) {
        const reRaw = await conCap(this.#extraerParteSigatoka('sp-03e1b-sigatoka-datos.md', 'Extrae SOLO el bloque DATOS (A..M, 3 columnas) del recorte ampliado.', cropDatos, mimeType, traceId, costCtx))
        const colsCrop = Array.isArray((reRaw as any)?.resumenColumnas)
          ? ((reRaw as any).resumenColumnas as any[]).map(calcularColumna)
          : []
        if (colsCrop.length === 3) {
          const mejor = elegirMejorDatos(merged.resumenColumnas, colsCrop)
          if (mejor !== merged.resumenColumnas) {
            trace.event({ name: 'sigatoka_datos_crop_elegido', level: 'DEFAULT', input: { dudosos_full: detectarCamposDudosos(merged.resumenColumnas).length, dudosos_crop: detectarCamposDudosos(colsCrop).length } })
            merged.resumenColumnas = mejor
          }
        }
      }
    }

    const camposDudososBase = detectarCamposDudosos(merged.resumenColumnas)

    // Tarea 2 — guard de lectura parcial del bloque DATOS: si la pasada e1
    // no leyó las 3 columnas, afirmar "todo bajo control" sería P1 violado.
    // Ejemplo real: 1 columna leída con J=0 cuando H3 tenía 47% EE2.
    const extrasDudosos: string[] = []
    if ((merged.resumenColumnas as unknown[]).length < 3) {
      extrasDudosos.push(`bloque DATOS incompleto (${(merged.resumenColumnas as unknown[]).length} de 3 columnas)`)
    }

    // Tarea 3 — checksum fallido → cola de revisión. Si tras los reintentos
    // una tabla sigue sin cuadrar, marcamos los campos específicos para que
    // el asesor pueda corregirlos desde la UI (D28).
    if (ver11Final?.cuadraTodo === false) {
      for (const col of ver11Final.columnas.filter(c => c.cuadra === false)) {
        extrasDudosos.push(`checksum 11 semanas: ${col.columna}`)
      }
    }
    if (ver00Final?.cuadraTodo === false) {
      for (const col of ver00Final.columnas.filter(c => c.cuadra === false)) {
        extrasDudosos.push(`checksum 00 semanas: ${col.columna}`)
      }
    }

    const camposDudosos = [...new Set([...camposDudososBase, ...extrasDudosos])]
    const parsed = SigatokaMuestreoSchema.safeParse({
      ...merged,
      requiereValidacion: camposDudosos.length > 0 || merged.confidenceScore < 0.75,
      camposDudosos,
    })

    if (parsed.success) {
      generation.end({ output: { semana: parsed.data.semana, finca: parsed.data.nombreFinca, confianza: parsed.data.confidenceScore, requiere_validacion: parsed.data.requiereValidacion, n_puntos: parsed.data.puntosMuestreo.length, n_11sem: parsed.data.plantas11sem.length, n_dudosos: camposDudosos.length, checksum_11: ver11Final?.cuadraTodo, checksum_00: ver00Final?.cuadraTodo } })
      return parsed.data
    }

    // Aun mergeando cuatro pasadas, si el schema falla rescatamos lo que haya en
    // vez de tirar (P1/P4) — marca requires_review para el asesor.
    const zodErrors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    trace.event({ name: 'sigatoka_zod_exhausted', level: 'ERROR', input: { final_errors: zodErrors } })
    const fallback = construirFallbackSigatoka(merged, zodErrors)
    generation.end({ output: { zod_valid: false, errors: zodErrors, fallback: true }, level: 'WARNING' })
    return fallback
  }

  // Una pasada (media ficha). Devuelve el JSON parseado best-effort, o null si la
  // llamada o el parseo fallan — el coordinador mergea lo que haya disponible.
  async #extraerParteSigatoka(
    promptName: string,
    userContent: string,
    base64: string,
    mimeType: string,
    traceId: string,
    costCtx?: CostContext,
  ): Promise<Record<string, unknown> | null> {
    const trace = this.#lf.trace({ id: traceId })
    try {
      const rawPrompt = await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId)
      const raw = await this.#adapter.generarTexto(userContent, {
        systemPrompt: rawPrompt,
        responseFormat: 'json_object',
        temperature: 0,
        imageBase64: base64,
        imageMimeType: mimeType,
        traceId,
        generationName: promptName.replace('.md', ''),
        modelClass: 'ultra',
        timeoutMs: 30_000,
        ...this.#costOpts(costCtx),
      })
      return JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch (err) {
      trace.event({ name: 'sigatoka_parte_error', level: 'WARNING', input: { parte: promptName, error: String(err) } })
      return null
    }
  }

  // Recorta una región de la imagen (coordenadas como fracción de la dimensión
  // original) y la reescala 3× para mejorar resolución antes de enviarla al LLM.
  // Devuelve la imagen recortada como base64 JPEG, o null ante cualquier error
  // (degradación graceful: el llamador usa la foto completa como respaldo).
  async #recortarRegion(
    base64: string,
    region: { left: number; top: number; width: number; height: number; zoom?: number },
    traceId?: string,
  ): Promise<string | null> {
    try {
      const buf = Buffer.from(base64, 'base64')
      const meta = await sharp(buf).metadata()
      const W = meta.width
      const H = meta.height
      if (!W || !H) return null

      const left   = Math.round(region.left   * W)
      const top    = Math.round(region.top    * H)
      const width  = Math.min(Math.round(region.width  * W), W - left)
      const height = Math.min(Math.round(region.height * H), H - top)

      if (width <= 0 || height <= 0) return null

      // Recorte + zoom + preprocesado de legibilidad (estándar de IDP/OCR de banca):
      // escala de grises quita el ruido de color (tinta azul), normalize estira el
      // contraste a rango completo, sharpen marca los trazos de los dígitos. Sube la
      // legibilidad del manuscrito sin llamadas extra. El zoom es configurable por
      // región (validado: más zoom resuelve misreads de dígito en tablas densas).
      const zoom = region.zoom ?? 3
      const outBuf = await sharp(buf)
        .extract({ left, top, width, height })
        .resize({ width: Math.round(width * zoom) })
        .grayscale()
        .normalize()
        .sharpen()
        .jpeg({ quality: 90 })
        .toBuffer()
      return outBuf.toString('base64')
    } catch (err) {
      if (traceId) {
        const trace = this.#lf.trace({ id: traceId })
        trace.event({ name: 'sigatoka_crop_error', level: 'WARNING', input: { region, error: String(err) } })
      }
      return null
    }
  }

  async onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string, costCtx?: CostContext): Promise<RespuestaOnboarding> {
    const promptName = 'sp-04a-onboarding-admin.md'
    const prompt = injectarVariables(
      await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId),
      {
        PASO_ACTUAL: String(contexto.preguntas_realizadas + 1),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      },
    )
    const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
    const userContent = `Historial:\n${historial}\nUsuario: ${mensaje}`

    return runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent,
      schema: RespuestaOnboardingSchema,
      traceId,
      classifierName: 'onboardar_agricultor',
      fallback: ONBOARDING_FALLBACK,
      modelClass: 'fast',
      temperature: 0,
      langfuseClient: this.#lf,
      generationInput: { mensaje },
      promptClient: PromptManager.getPromptClient(promptName),
      ...this.#costOpts(costCtx),
    })
  }

  async onboardarAgricultor(mensaje: string, contexto: ContextoOnboardingAgricultor, traceId: string, costCtx?: CostContext): Promise<RespuestaOnboarding> {
    const promptName = 'sp-04b-onboarding-agricultor.md'
    const prompt = injectarVariables(
      await PromptManager.getPrompt(promptName, `prompts/${promptName}`, traceId),
      {
        PASO_ACTUAL: String(contexto.paso_actual),
        DATOS_RECOPILADOS: JSON.stringify(contexto.datos_recolectados),
        FINCAS_DISPONIBLES: contexto.fincas_disponibles,
        NOMBRE_USUARIO: (contexto.datos_recolectados['nombre'] as string | undefined) ?? '',
      },
    )
    const historial = contexto.historial.map(h => `${h.rol}: ${h.contenido}`).join('\n')
    const userContent = `Historial:\n${historial}\nUsuario: ${mensaje}`

    return runTypedClassifier({
      adapter:         this.#adapter,
      systemPrompt:    prompt,
      userContent,
      schema:          RespuestaOnboardingSchema,
      traceId,
      classifierName:  'onboardar_agricultor',
      fallback:        ONBOARDING_FALLBACK,
      modelClass:      'fast',
      temperature:     0,
      langfuseClient:  this.#lf,
      generationInput: { mensaje },
      promptClient:    PromptManager.getPromptClient(promptName),
    })
  }

  async resumirSemana(entrada: EntradaResumenSemanal, traceId: string, costCtx?: CostContext): Promise<ResumenSemanal> {
    const trace = this.#lf.trace({ id: traceId })
    const resumenPromptName = 'sp-05-resumen-semanal.md'
    // Prefetch para que getPromptClient devuelva el PromptClient cacheado.
    await PromptManager.getPrompt(resumenPromptName, `prompts/${resumenPromptName}`, traceId)
    const resumenGenOpts: Record<string, unknown> = { name: 'resumir_semana', model: 'wasagro/orchestrator', input: { finca_id: entrada.finca_id, total_eventos: entrada.eventos.length } }
    const resumenPc = PromptManager.getPromptClient(resumenPromptName)
    if (resumenPc) resumenGenOpts['prompt'] = resumenPc
    const generation = trace.generation(resumenGenOpts as any)
    try {
      const forecastTexto = entrada.forecast
        ? [
            `Días con lluvia (>60%): ${entrada.forecast.dias_lluvia} de 7`,
            `Lluvia acumulada estimada: ${entrada.forecast.mm_total}mm`,
            `${entrada.forecast.ventana_aplicacion}`,
            entrada.forecast.dias
              .map(d => `  ${d.fecha}: ${d.precipitacion_pct}% lluvia, ${d.precipitacion_mm}mm, temp min ${d.temp_min}°C`)
              .join('\n'),
          ].join('\n')
        : 'Sin pronóstico disponible para esta finca.'

      // Plagas agrupadas por nivel de umbral — datos pre-calculados por el backend
      type PlagaNivel = { plaga_tipo: string; bajo: string[]; medio: string[]; alto: string[]; critico: string[]; sin_umbral: string[] }
      const plagasPorNivel = (entrada as EntradaResumenSemanal & { plagasPorNivel?: PlagaNivel[] }).plagasPorNivel ?? []
      const plagasTexto = plagasPorNivel.length
        ? plagasPorNivel.map(p => {
            const lineas: string[] = [`${p.plaga_tipo}:`]
            if (p.critico.length)    lineas.push(`  Umbral crítico: ${p.critico.join(', ')}`)
            if (p.alto.length)       lineas.push(`  Umbral alto: ${p.alto.join(', ')}`)
            if (p.medio.length)      lineas.push(`  Umbral medio: ${p.medio.join(', ')}`)
            if (p.bajo.length)       lineas.push(`  Umbral bajo: ${p.bajo.join(', ')}`)
            if (p.sin_umbral.length) lineas.push(`  Sin umbral configurado: ${p.sin_umbral.join(', ')}`)
            return lineas.join('\n')
          }).join('\n\n')
        : 'Sin plagas registradas esta semana.'

      const prompt = injectarVariables((await PromptManager.getPrompt('sp-05-resumen-semanal.md', 'prompts/sp-05-resumen-semanal.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
        FINCA_NOMBRE:       entrada.finca_nombre,
        CULTIVO_PRINCIPAL:  entrada.cultivo_principal,
        PAIS:               entrada.pais ?? 'EC',
        FECHA_INICIO:       entrada.fecha_inicio,
        FECHA_FIN:          entrada.fecha_fin,
        EVENTOS_AGREGADOS:  JSON.stringify(entrada.eventos, null, 2),
        FORECAST_SEMANAL:   forecastTexto,
        PLAGAS_POR_NIVEL:   plagasTexto,
      })
      const texto = await this.#adapter.generarTexto(`Finca: ${entrada.finca_nombre}. Genera el resumen de los eventos de la semana.`, { systemPrompt: prompt, responseFormat: 'json_object', temperature: 0, traceId, generationName: 'resumen_semanal', ...this.#costOpts(costCtx) })
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

  async extraerDatosSDR(textoMensaje: string, contextoActual: string, traceId: string, costCtx?: CostContext): Promise<ExtraccionSDR> {
    const trace = this.#lf.trace({ id: traceId })
    const extPromptName = 'SP-SDR-02-extractor.md'
    const prompt = await PromptManager.getPrompt(extPromptName, `sdr/prompts/${extPromptName}`, traceId)
    const extGenOpts: Record<string, unknown> = {
      name: 'extraer_datos_sdr',
      model: 'wasagro/orchestrator',
      input: { mensaje: textoMensaje },
    }
    const extPc = PromptManager.getPromptClient(extPromptName)
    if (extPc) extGenOpts['prompt'] = extPc
    const generation = trace.generation(extGenOpts as any)

    const inicio = Date.now()
    try {
      const userContent = `Contexto Actual del Prospecto:\n${contextoActual}\n\nMensaje Actual: ${textoMensaje}`

      const texto = await this.#adapter.generarTexto(userContent, {
        systemPrompt: prompt,
        responseFormat: 'json_object',
        traceId,
        generationName: 'extraer_sdr',
        modelClass: 'fast',
        temperature: 0,
        ...this.#costOpts(costCtx),
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

  async redactarMensajeSDR(mensajeUsuario: string, contextoActual: string, directiva: string, traceId: string, costCtx?: CostContext): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const redactPromptName = 'SP-SDR-03-writer.md'
    const prompt = await PromptManager.getPrompt(redactPromptName, `sdr/prompts/${redactPromptName}`, traceId)
    const redactGenOpts: Record<string, unknown> = {
      name: 'redactar_mensaje_sdr',
      model: 'wasagro/orchestrator',
      input: { directiva },
    }
    const redactPc = PromptManager.getPromptClient(redactPromptName)
    if (redactPc) redactGenOpts['prompt'] = redactPc
    const generation = trace.generation(redactGenOpts as any)

    try {
      const userContent = `Contexto del Prospecto:\n${contextoActual}\n\nÚltimo mensaje del usuario: "${mensajeUsuario}"\n\n=== DIRECTIVA OBLIGATORIA ===\n${directiva}`

      const texto = await this.#adapter.generarTexto(userContent, {
        systemPrompt: prompt,
        responseFormat: 'text',
        traceId,
        generationName: 'redactar_sdr',
        modelClass: 'fast',
        ...this.#costOpts(costCtx),
      })

      generation.end({ output: texto })
      return texto.trim()
    } catch (err) {
      if (err instanceof LLMError) throw err
      generation.end({ output: String(err), level: 'ERROR' })
      throw new LLMError('GROQ_ERROR', `Error en Redactor SDR: ${String(err)}`, err)
    }
  }

  async clasificarIntencionSDR(
    texto: string,
    opciones: readonly string[],
    contexto: string,
    traceId: string,
    costCtx?: CostContext,
  ): Promise<string> {
    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'clasificar_intencion_sdr',
      model: 'wasagro/orchestrator',
      input: { texto, opciones },
    })

    const systemPrompt = `Eres un clasificador. Tu única tarea es analizar el mensaje del usuario y elegir UNA opción exacta de la lista proporcionada.

Reglas:
- Devuelve EXCLUSIVAMENTE un JSON: {"intencion":"<opcion>"}
- "<opcion>" DEBE ser una de las opciones literales del input. No inventes.
- Si ninguna opción aplica claramente, elige "other".
- NO escribas explicación. NO uses Markdown. Solo el JSON.`

    const userContent = `Opciones permitidas: ${JSON.stringify(opciones)}\n\nContexto:\n${contexto}\n\nMensaje del usuario: "${texto}"`

    try {
      const raw = await this.#adapter.generarTexto(userContent, {
        systemPrompt,
        responseFormat: 'json_object',
        traceId,
        generationName: 'clasificar_intencion_sdr',
        modelClass: 'fast',
        temperature: 0,
        ...this.#costOpts(costCtx),
      })
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim()
      let parsed: unknown
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        generation.end({ output: raw, level: 'WARNING' })
        return 'other'
      }
      const intencion = (parsed as { intencion?: unknown })?.intencion
      if (typeof intencion === 'string' && opciones.includes(intencion)) {
        generation.end({ output: { intencion } })
        return intencion
      }
      generation.end({ output: { intencion, fallback: 'other' }, level: 'WARNING' })
      return 'other'
    } catch (err) {
      generation.end({ output: String(err), level: 'ERROR' })
      return 'other'
    }
  }

  async clasificarExcel(entrada: EntradaClasificacionExcel, traceId: string, costCtx?: CostContext): Promise<ClasificacionExcel> {
    const excelPromptName = 'sp-06-clasificar-excel.md'
    const prompt = injectarVariables(
      await PromptManager.getPrompt(excelPromptName, `prompts/${excelPromptName}`, traceId),
      {
        FINCA_NOMBRE:      entrada.finca_nombre ?? 'No especificada',
        CULTIVO_PRINCIPAL: entrada.cultivo_principal ?? 'No especificado',
        NOMBRE_ARCHIVO:    entrada.nombre_archivo,
        COLUMNAS:          entrada.columnas.join(', '),
        MUESTRA_FILAS:     JSON.stringify(entrada.muestra_filas, null, 2),
        TOTAL_FILAS:       String(entrada.total_filas),
      },
    )
    const userContent = `Archivo: ${entrada.nombre_archivo}. Columnas: ${entrada.columnas.join(', ')}. Total filas: ${entrada.total_filas}.`

    // Safe fallback: the upstream caller treats 'desconocido' as "ask the user
    // what this file is about" — that's exactly the right thing to do when the
    // model gave up. Empty columnas keeps the contract simple downstream.
    const fallback: ClasificacionExcel = {
      tipo_datos:           'desconocido',
      filas_detectadas:     entrada.total_filas,
      columnas_detectadas:  entrada.columnas,
      cultivo_detectado:    entrada.cultivo_principal ?? null,
      confianza:            0,
      mensaje_confirmacion: 'No pude clasificar el archivo automáticamente. ¿Podés contarme brevemente de qué se trata?',
    }

    return runTypedClassifier({
      adapter: this.#adapter,
      systemPrompt: prompt,
      userContent,
      schema: ClasificacionExcelSchema,
      traceId,
      classifierName: 'clasificar_excel',
      fallback,
      modelClass: 'fast',
      temperature: 0,
      langfuseClient: this.#lf,
      generationInput: { nombre_archivo: entrada.nombre_archivo, total_filas: entrada.total_filas },
      promptClient: PromptManager.getPromptClient(excelPromptName),
      ...this.#costOpts(costCtx),
    })
  }

  // ─── private ─────────────────────────────────────────────────────────────

  async #clasificar(input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<ResultadoClasificacion> {
    const prompt = injectarVariables((await PromptManager.getPrompt('sp-00-clasificador.md', 'prompts/sp-00-clasificador.md', typeof traceId !== 'undefined' ? traceId : undefined)), {
      FINCA_NOMBRE: input.finca_nombre ?? input.finca_id,
      CULTIVO_PRINCIPAL: input.cultivo_principal ?? 'No especificado',
      NOMBRE_USUARIO: input.nombre_usuario ?? '',
      MENSAJE: input.transcripcion,
    })

    const trace = this.#lf.trace({ id: traceId })
    const generation = trace.generation({
      name: 'clasificar_mensaje',
      model: 'wasagro/orchestrator',
      input: { transcripcion: input.transcripcion },
    })

    const inicio = Date.now()
    try {
      const textoRaw = await this.#adapter.generarTexto(input.transcripcion, {
        systemPrompt: prompt,
        responseFormat: 'json_object',
        traceId,
        generationName: 'event_classify',
        modelClass: 'fast',
        temperature: 0,
        ...this.#costOpts(costCtx),
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
    costCtx?: CostContext,
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
      model: 'wasagro/orchestrator',
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
        temperature: 0,
        traceId,
        generationName: `llamar_react_iter_${iterations}`,
        modelClass: 'reasoning',
        tools: SupabaseTools,
        ...this.#costOpts(costCtx),
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
              trace.event({ name: 'mcp_tool_execute_error', level: 'ERROR', input: { tool: name, args, error: toolErr.message } })
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

        // Filtro de confianza determinista (P1): anula campos de baja confianza
        // ANTES de devolver, para que ningún valor "adivinado" se persista.
        const { evento: eventoFiltrado, camposAnulados } = aplicarFiltroConfianza(parsed.data)
        if (camposAnulados.length > 0) {
          trace.event({
            name: 'confidence_filter_nulled_fields',
            level: 'WARNING',
            output: { tipo_evento, campos_anulados: camposAnulados, confidence_score: eventoFiltrado.confidence_score },
          })
        }

        const latencia = Date.now() - inicio
        generation.end({ output: eventoFiltrado, metadata: { latencia_ms: latencia, react_iterations: iterations + 1, campos_anulados: camposAnulados.length } })
        return eventoFiltrado

      } catch (err) {
        if (err instanceof LLMError) throw err
        generation.end({ output: String(err), level: 'ERROR' })
        throw new LLMError('GROQ_ERROR', `Error extrayendo ${tipo_evento}: ${String(err)}`, err)
      }
    }

    throw new LLMError('REACT_ERROR', `Se alcanzó el límite máximo de iteraciones (${maxIterations}) sin convergencia en la extracción.`)
  }

  
}
