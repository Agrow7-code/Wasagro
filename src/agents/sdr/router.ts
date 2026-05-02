import { z } from 'zod'
import { langfuse } from '../../integrations/langfuse.js'
import type { IWasagroLLM } from '../../integrations/llm/IWasagroLLM.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExtraccionSDRSchema, type SDRNode } from '../../types/dominio/SDRTypes.js'
import { updateSDRProspecto, saveSDRInteraccion } from '../../pipeline/supabaseQueries.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { getCachedContext, setCachedContext } from '../../integrations/redis.js'

export interface SDRRouterContext {
  prospecto: Record<string, unknown>
  textoOriginal: string
  traceId: string
  llm: IWasagroLLM
  sender: IWhatsAppSender
  client?: SupabaseClient
}

const ObjectionClassifierSchema = z.object({
  objeciones_detectadas: z.boolean(),
  razon: z.string().optional()
})

const MAX_SDR_TURNS = 4

function calcularPrecio(segmento_icp: string, fincas: number): string {
  if (segmento_icp === 'exportadora') return 'Tenemos planes personalizados para operaciones grandes. Nos gustaría hacer una videollamada para entender tu volumen y armarte una propuesta a medida.'
  if (segmento_icp === 'ong') return 'Manejamos precios especiales con descuento para organizaciones sin fines de lucro. Hablemos unos minutos para cotizarte el alcance exacto.'
  return 'Es un costo variable según el tamaño de tu finca y las hectáreas activas. Lo mejor es agendar una breve llamada para darte el precio exacto.'
}

export async function routeSDRNode(ctx: SDRRouterContext): Promise<void> {
  const { prospecto, textoOriginal, traceId, llm, sender, client } = ctx
  const trace = langfuse.trace({ id: traceId })
  
  let currentNode = (prospecto['sdr_node'] as SDRNode) ?? 'triage'
  const nuevoTurno = (prospecto['turns_total'] as number) + 1
  
  // 1. Global Fallback Check (Semantic Caching via Redis)
  const cachedFallback = await getCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`)
  if (cachedFallback && currentNode !== 'triage') {
    await sender.enviarTexto(prospecto['phone'] as string, cachedFallback)
    await saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: prospecto['phone'],
      turno: nuevoTurno,
      tipo: 'inbound',
      contenido: textoOriginal,
      action_taken: 'global_fallback_answered',
      langfuse_trace_id: traceId,
    }, client)
    return
  }

  // Handle known off-topic fallback and cache it for future similar exact queries
  const isOffTopic = textoOriginal.toLowerCase().includes('funciona sin internet') || textoOriginal.toLowerCase().includes('precio')
  if (isOffTopic && currentNode !== 'triage') {
    if (textoOriginal.toLowerCase().includes('funciona sin internet')) {
      const fallbackResponse = 'Sí, Wasagro funciona completamente sin internet en la finca. Puedes enviar tus mensajes de WhatsApp y se sincronizarán cuando recuperes la señal.'
      await sender.enviarTexto(prospecto['phone'] as string, fallbackResponse)
      
      // Store in Redis semantic cache
      await setCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`, fallbackResponse, 86400 * 7)

      await saveSDRInteraccion({
        prospecto_id: prospecto['id'],
        phone: prospecto['phone'],
        turno: nuevoTurno,
        tipo: 'inbound',
        contenido: textoOriginal,
        action_taken: 'global_fallback_answered',
        langfuse_trace_id: traceId,
      }, client)
      return
    }
  }

  // Dual-Tier Memory: Get previous fast context if available to augment DB state
  const cachedSDRContext = await getCachedContext(prospecto['phone'] as string)
  
  // 2. Reflect: Decoupled Extraction & Zod Validation (Fast Tier)
  const contextoActual = `
Fincas/Hectáreas: ${prospecto['fincas_en_cartera'] ?? 'Desconocido'}
Cultivo Principal: ${prospecto['cultivo_principal'] ?? 'Desconocido'}
País: ${prospecto['pais'] ?? 'Desconocido'}
Sistema Actual: ${prospecto['sistema_actual'] ?? 'Desconocido'}
${cachedSDRContext ? `Contexto Reciente: ${cachedSDRContext}` : ''}
  `.trim()

  let extraccionValidada: z.infer<typeof ExtraccionSDRSchema> | null = null
  let correctionLoopError = ''

  try {
    const rawExtraccion = await llm.extraerDatosSDR(textoOriginal, contextoActual, traceId)
    // Zod Validation (Telemetry on failure)
    extraccionValidada = ExtraccionSDRSchema.parse(rawExtraccion)
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('[SDR Telemetry] Zod Validation Failed:', err.errors)
      trace.event({ name: 'sdr_extraction_zod_failure', level: 'WARNING', input: err.errors })
      correctionLoopError = `El modelo extrajo un formato inválido. Detalles: ${err.message}. Ignora la extracción y haz una pregunta aclaratoria.`
    }
  }

  // Merging state
  const updateData: Record<string, unknown> = { turns_total: nuevoTurno }
  let combinedProspecto = { ...prospecto }

  if (extraccionValidada) {
    if (extraccionValidada.fincas_en_cartera != null && prospecto['fincas_en_cartera'] == null) updateData.fincas_en_cartera = extraccionValidada.fincas_en_cartera
    if (extraccionValidada.cultivo_principal != null && prospecto['cultivo_principal'] == null) updateData.cultivo_principal = extraccionValidada.cultivo_principal
    if (extraccionValidada.pais != null && prospecto['pais'] == null) updateData.pais = extraccionValidada.pais
    if (extraccionValidada.sistema_actual != null && prospecto['sistema_actual'] == null) updateData.sistema_actual = extraccionValidada.sistema_actual
    
    combinedProspecto = { ...prospecto, ...updateData }
  }

  // Evaluate Variables
  let datosConocidos = 0
  if (combinedProspecto['fincas_en_cartera'] != null) datosConocidos++
  if (combinedProspecto['cultivo_principal'] != null) datosConocidos++
  if (combinedProspecto['pais'] != null) datosConocidos++
  if (combinedProspecto['sistema_actual'] != null) datosConocidos++

  // 3. Non-Linear Transitions (FSM)
  if (currentNode === 'triage') {
    if (extraccionValidada?.es_spam) {
      updateData.status = 'unqualified'
      await updateSDRProspecto(prospecto['id'] as string, updateData, client)
      await sender.enviarTexto(prospecto['phone'] as string, 'Soy el asistente de Wasagro, un sistema para operaciones agrícolas. Creo que te has equivocado de número. ¡Que tengas un buen día! 👋')
      return
    }
    currentNode = 'discovery'
    updateData.sdr_node = currentNode
  }

  if (currentNode === 'discovery') {
    // Regression check: If user invalidated a known variable, it would drop from combinedProspecto.
    // Transition to Pitch if all 4 variables are known
    if (datosConocidos >= 4 || nuevoTurno >= MAX_SDR_TURNS) {
      currentNode = 'pitch'
      updateData.sdr_node = currentNode
    }
  }

  if (currentNode === 'pitch') {
    // After pitching in the previous turn, the user responds. 
    // We must check if they have strong objections.
    if (nuevoTurno > 2) {
      const objectionCheck = await llm.redactarMensajeSDR(
        textoOriginal, 
        contextoActual, 
        'Evalúa si el usuario tiene una objeción fuerte a agendar una demostración. Responde SOLO en JSON: {"objeciones_detectadas": true/false}',
        traceId
      )
      try {
        const isObjection = JSON.parse(objectionCheck).objeciones_detectadas
        if (!isObjection) {
          currentNode = 'close'
          updateData.sdr_node = currentNode
        } else {
          trace.event({ name: 'sdr_objection_detected', level: 'DEFAULT', input: { objectionCheck } })
        }
      } catch (e) {
        // Fallback safely to pitch node if JSON parsing fails
        console.warn('Failed to parse objection check:', e)
      }
    }
  }

  // 4. Act: Plan & Generate Response (Deterministic Guardrails & CTWA Context)
  let directiva = ''
  let requires_founder_approval = false
  const ctwaContext = prospecto['source_context'] ? ` [NOTA: El cliente llegó desde el anuncio: ${prospecto['source_context']}. Usa esto para personalizar tu saludo o enfoque].` : ''
  
  if (currentNode === 'discovery') {
    if (correctionLoopError) {
      directiva = `${correctionLoopError} Pregunta de nuevo de forma natural. MÁXIMO 3 oraciones o 90 palabras.`
    } else if (combinedProspecto['fincas_en_cartera'] == null) {
      directiva = `Haz una pregunta corta sobre cuántas hectáreas o fincas administran actualmente.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (combinedProspecto['cultivo_principal'] == null) {
      directiva = `Haz una pregunta corta sobre qué tipo de cultivo principal tienen.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (combinedProspecto['pais'] == null) {
      directiva = 'Pregunta en qué país está ubicada su finca. MÁXIMO 3 oraciones o 90 palabras.'
    } else if (combinedProspecto['sistema_actual'] == null) {
      directiva = 'Pregunta cómo registran actualmente las labores o aplicaciones de insumos (ej. papel, Excel). MÁXIMO 3 oraciones o 90 palabras.'
    }
  } else if (currentNode === 'pitch') {
    directiva = `Usa los datos recopilados para redactar un argumento persuasivo que genere un "aha moment". En lugar de solo describir funciones, enfócate en el problema de usar ${combinedProspecto['sistema_actual']} y cómo Wasagro les ahorrará horas de trabajo en sus ${combinedProspecto['fincas_en_cartera']} hectáreas/fincas de ${combinedProspecto['cultivo_principal']}, evitando pérdidas con alertas tempranas y tableros automáticos por WhatsApp. ESTRICTO: NO PIDAS AGENDAR REUNIÓN TODAVÍA. MÁXIMO 3 oraciones y 90 palabras.`
  } else if (currentNode === 'close') {
    requires_founder_approval = true
    directiva = 'El cliente no tiene objeciones fuertes. Cierra el trato pidiendo una demostración mediante una pregunta cerrada ofreciendo dos opciones de bajo compromiso. ESTRICTO: Termina obligatoriamente con algo como "¿Te parece si agendamos 10 minutitos para mostrarte cómo se ve, o prefieres que te envíe un PDF con casos de éxito?". MÁXIMO 3 oraciones o 90 palabras.'
  }

  const respuesta = await llm.redactarMensajeSDR(textoOriginal, contextoActual, directiva, traceId)

  // Cache recent response in Dual-Tier Memory
  await setCachedContext(prospecto['phone'] as string, respuesta, 3600 * 24)

  // 5. Execution (Atomic State Update)
  // `updateSDRProspecto` updates all provided properties atomically.
  if (requires_founder_approval) {
    updateData.status = 'piloto_propuesto'
    updateData.founder_notified_at = new Date().toISOString()
    const brief = {
      draft_message: respuesta,
      fincas_en_cartera: combinedProspecto['fincas_en_cartera'],
      cultivo_principal: combinedProspecto['cultivo_principal'],
      pais: combinedProspecto['pais'],
      sistema_actual: combinedProspecto['sistema_actual'],
      segmento_icp: combinedProspecto['segmento_icp']
    }
    updateData.deal_brief = brief
  } else if (currentNode === 'discovery' && prospecto['status'] === 'new') {
    updateData.status = 'en_discovery'
  }

  // Execute atomic state update in DB
  await updateSDRProspecto(prospecto['id'] as string, updateData, client)

  // Send message
  await sender.enviarTexto(prospecto['phone'] as string, respuesta)
  if (requires_founder_approval) {
    const bookingUrl = process.env['DEMO_BOOKING_URL']
    const followUp = bookingUrl
      ? `📅 Puedes elegir el horario aquí: ${bookingUrl}`
      : '¿Qué día y hora te queda mejor la próxima semana? 📅'
    await sender.enviarTexto(prospecto['phone'] as string, followUp)
    trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: prospecto['id'] } })
  }

  // Persist interaction
  await saveSDRInteraccion({
    prospecto_id: prospecto['id'],
    phone: prospecto['phone'],
    turno: nuevoTurno,
    tipo: 'inbound',
    contenido: textoOriginal,
    action_taken: currentNode,
    langfuse_trace_id: traceId,
  }, client)
}