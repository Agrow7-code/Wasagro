import { z } from 'zod'
import { langfuse } from '../../integrations/langfuse.js'
import type { IWasagroLLM } from '../../integrations/llm/IWasagroLLM.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExtraccionSDRSchema } from '../../types/dominio/SDRTypes.js'
import { updateSDRProspecto, saveSDRInteraccion } from '../../pipeline/supabaseQueries.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { getCachedContext, setCachedContext } from '../../integrations/redis.js'
import { reduceContext, type ConvContext, type Intent, type SDRFsmState } from './context.js'
import {
  hydrateContext,
  computeLegacyUpdate,
  mapExtraccionToUpdate,
  buildContextoString,
} from './contextStore.js'

export interface SDRRouterContext {
  prospecto: Record<string, unknown>
  textoOriginal: string
  traceId: string
  llm: IWasagroLLM
  sender: IWhatsAppSender
  client?: SupabaseClient
}

const MAX_SDR_TURNS = 4

export async function routeSDRNode(rctx: SDRRouterContext): Promise<void> {
  const { prospecto, textoOriginal, traceId, llm, sender, client } = rctx
  const trace = langfuse.trace({ id: traceId })

  // ── HYDRATE FIRST — must precede any classifier call (resuelve H1 ADR-009).
  //    All prospecto[...] accesses live inside hydrateContext(). The router
  //    only reads from ctx and legacy from this point on.
  const initial = hydrateContext(prospecto)
  let ctx = initial.ctx
  const { sourceContext, statusActual } = initial.legacy

  // ── 1. Global Fallback Check (Semantic Caching via Redis, no LLM) ─────────
  const cachedFallback = await getCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`)
  if (cachedFallback && ctx.fsmState !== 'triage') {
    await sender.enviarTexto(ctx.phone, cachedFallback)
    await saveSDRInteraccion({
      prospecto_id: ctx.prospectId,
      phone: ctx.phone,
      turno: ctx.turnCount + 1,
      tipo: 'inbound',
      contenido: textoOriginal,
      action_taken: 'global_fallback_answered',
      langfuse_trace_id: traceId,
    }, client)
    return
  }

  // Handle known off-topic fallback and cache it for future similar exact queries
  const isOffTopic = textoOriginal.toLowerCase().includes('funciona sin internet') || textoOriginal.toLowerCase().includes('precio')
  if (isOffTopic && ctx.fsmState !== 'triage') {
    if (textoOriginal.toLowerCase().includes('funciona sin internet')) {
      const fallbackResponse = 'Sí, Wasagro funciona completamente sin internet en la finca. Puedes enviar tus mensajes de WhatsApp y se sincronizarán cuando recuperes la señal.'
      await sender.enviarTexto(ctx.phone, fallbackResponse)
      await setCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`, fallbackResponse, 86400 * 7)
      await saveSDRInteraccion({
        prospecto_id: ctx.prospectId,
        phone: ctx.phone,
        turno: ctx.turnCount + 1,
        tipo: 'inbound',
        contenido: textoOriginal,
        action_taken: 'global_fallback_answered',
        langfuse_trace_id: traceId,
      }, client)
      return
    }
  }

  // ── 2. Build contextoActual string from ConvContext ───────────────────────
  // Fase B replaces the legacy classifier methods with one that consumes
  // ConvContext directly. Until then, we pass the same info as a string so the
  // classifier at least sees lastBotMessage and intentHistory.
  const cachedSDRContext = await getCachedContext(ctx.phone)
  const contextoActual = buildContextoString(ctx, cachedSDRContext)

  // ── 3. Extraction (Fase B moves this to classifier.ts) ────────────────────
  let extraccionValidada: z.infer<typeof ExtraccionSDRSchema> | null = null
  let correctionLoopError = ''
  try {
    const rawExtraccion = await llm.extraerDatosSDR(textoOriginal, contextoActual, traceId)
    extraccionValidada = ExtraccionSDRSchema.parse(rawExtraccion)
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('[SDR Telemetry] Zod Validation Failed:', err.errors)
      trace.event({ name: 'sdr_extraction_zod_failure', level: 'WARNING', input: err.errors })
      correctionLoopError = `El modelo extrajo un formato inválido. Detalles: ${err.message}. Ignora la extracción y haz una pregunta aclaratoria.`
    }
  }

  // ── 4. Triage: spam shortcut (no further pipeline) ────────────────────────
  if (ctx.fsmState === 'triage' && extraccionValidada?.es_spam) {
    const updateData: Record<string, unknown> = {
      turns_total: ctx.turnCount + 1,
      status: 'unqualified',
    }
    await updateSDRProspecto(ctx.prospectId, updateData, client)
    await sender.enviarTexto(ctx.phone, 'Soy el asistente de Wasagro, un sistema para operaciones agrícolas. Creo que te has equivocado de número. ¡Que tengas un buen día! 👋')
    return
  }

  // ── 5. FSM transitions (legacy logic operating on ConvContext) ────────────
  // BRIDGE: Fase B unifies these transitions inside reduceContext() with a real
  // intent classifier. For Commit 2 we keep the existing rules and snapshot the
  // resulting fsmState + turnIntent for the final reduce() call below.
  let nextFsmState: SDRFsmState = ctx.fsmState === 'triage' ? 'discovery' : ctx.fsmState
  let turnIntent: Intent = 'neutro'

  const nuevoTurno = ctx.turnCount + 1

  if (nextFsmState === 'discovery') {
    const hitMaxTurns = nuevoTurno >= MAX_SDR_TURNS && ctx.datosConocidos >= 2
    if (ctx.datosConocidos >= 3 || hitMaxTurns) {
      nextFsmState = 'pitch_sent'
    }
  }

  if (nextFsmState === 'pitch_sent' && nuevoTurno > 2) {
    // Pass the full ConvContext-derived contextoActual so the classifier sees
    // lastBotMessage and intentHistory. This is what resolves H1 of ADR-009:
    // "Ya?" is ambiguous in isolation but unambiguous once the classifier knows
    // the bot just sent the pitch.
    const objIntent = await llm.clasificarIntencionSDR(
      textoOriginal,
      ['objection', 'advance', 'other'] as const,
      `${contextoActual}\n\nInstrucción: Después del pitch, el usuario responde. Clasifica: "objection" = objeción real (no presupuesto, no tiempo, no interés, ya tengo X, prefiero pensarlo). "advance" = quiere avanzar / muestra interés / pregunta corta como "ya?", "ok", "y entonces?", "cuéntame más". "other" = ninguna de las anteriores.`,
      traceId,
    )
    if (objIntent === 'advance' || objIntent === 'other') {
      nextFsmState = 'closing'
      turnIntent = objIntent === 'advance' ? 'advance' : 'other'
    } else {
      // The 'objection' label here is a coarse signal; Fase B emits a typed
      // ObjectionType (precio / tiempo / confianza). For now, treat as generic.
      turnIntent = 'objection_trust'
      trace.event({ name: 'sdr_objection_detected', level: 'DEFAULT', input: { intent: objIntent } })
    }
  }

  // ── 6. Plan directive (reads from ctx, not prospecto) ─────────────────────
  let directiva = ''
  let requires_founder_approval = false
  const ctwaContext = sourceContext ? ` [NOTA: El cliente llegó desde el anuncio: ${sourceContext}. Usa esto para personalizar tu saludo o enfoque].` : ''

  if (nextFsmState === 'discovery') {
    if (correctionLoopError) {
      directiva = `${correctionLoopError} Pregunta de nuevo de forma natural. MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.fincasEstimadas == null) {
      directiva = `Haz una pregunta corta sobre cuántas hectáreas o fincas administran actualmente.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.cultivo == null) {
      directiva = `Haz una pregunta corta sobre qué tipo de cultivo principal tienen.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.pais == null) {
      directiva = 'Pregunta en qué país está ubicada su finca. MÁXIMO 3 oraciones o 90 palabras.'
    } else if (ctx.sistemaActual == null) {
      directiva = 'Pregunta cómo registran actualmente las labores o aplicaciones de insumos (ej. papel, Excel). MÁXIMO 3 oraciones o 90 palabras.'
    }
  } else if (nextFsmState === 'pitch_sent') {
    // Pitch body uses the prospect's already-extracted cultivo/sistema for personalization.
    // Some of these may be null if the FSM hit MAX_SDR_TURNS without all data — the prompt
    // is designed to gracefully handle missing slots ("tu cultivo" instead of explicit name).
    const cultivoLabel = ctx.cultivo ?? 'tu cultivo'
    const sistemaLabel = ctx.sistemaActual ?? 'el método actual'
    const fincasLabel = ctx.fincasEstimadas ?? 'tus'
    directiva = `Usa los datos recopilados para redactar un argumento persuasivo que genere un "aha moment". En lugar de solo describir funciones, enfócate en el problema de usar ${sistemaLabel} y cómo Wasagro les ahorrará horas de trabajo en sus ${fincasLabel} hectáreas/fincas de ${cultivoLabel}, evitando pérdidas con alertas tempranas y tableros automáticos por WhatsApp.

ESTRICTO:
- NO pidas agendar la demo en este mensaje (eso lo hace el siguiente turno).
- SÍ termina obligatoriamente con UNA pregunta corta de validación que invite al cliente a responder. Nunca cierres con un párrafo explicativo "en aire" — el cliente se queda sin saber qué responder y se va. Ejemplos válidos: "¿Te hace sentido para tu finca?" / "¿Esto te suena con lo que vivís?" / "¿Cómo registran hoy lo que pasa en el lote?" / "¿Querés que te muestre cómo se vería con tus aguacates?"
- La pregunta NO es agendar la demo — es validar interés o profundizar el dolor.
- MÁXIMO 3 oraciones y 90 palabras en total (la pregunta cuenta como una oración).`
  } else if (nextFsmState === 'closing') {
    requires_founder_approval = true
    directiva = 'El cliente no tiene objeciones fuertes. Cierra el trato ofreciendo dos opciones de bajo compromiso: una demo corta o un brochure por su segmento. ESTRICTO: Termina obligatoriamente con algo como "¿Te parece si agendamos 10 minutitos para mostrarte cómo se ve, o preferís que te mande el brochure con la info para tu segmento?". NO menciones "casos de éxito" ni "PDF de casos" (no los tenemos). MÁXIMO 3 oraciones o 90 palabras.'
  }

  const respuesta = await llm.redactarMensajeSDR(textoOriginal, contextoActual, directiva, traceId)

  // Cache recent response in Dual-Tier Memory
  await setCachedContext(ctx.phone, respuesta, 3600 * 24)

  // ── 7. REDUCE: single, atomic context update for this turn ────────────────
  // Replaces the 5 inline mutations (ex-lines 104-115) with one pure call.
  // We override fsmState afterwards because the legacy FSM logic above decided
  // the transition (Fase B will move that decision into the reducer/classifier).
  const extraction = extraccionValidada ? mapExtraccionToUpdate(extraccionValidada) : {}
  ctx = reduceContext(ctx, {
    classification: { intent: turnIntent, confidence: 1.0 },
    extraction,
    botMessage: respuesta,
  })
  // BRIDGE: stamp the FSM transition chosen by the legacy block above.
  ctx = { ...ctx, fsmState: nextFsmState }

  // ── 8. Persist legacy row + send message ──────────────────────────────────
  const updateData = computeLegacyUpdate(ctx, initial)
  if (requires_founder_approval) {
    updateData.status = 'piloto_propuesto'
    updateData.founder_notified_at = new Date().toISOString()
    updateData.deal_brief = {
      draft_message: respuesta,
      fincas_en_cartera: ctx.fincasEstimadas,
      cultivo_principal: ctx.cultivo,
      pais: ctx.pais,
      sistema_actual: ctx.sistemaActual,
      segmento_icp: ctx.segmento,
    }
  } else if (nextFsmState === 'discovery' && statusActual === 'new') {
    updateData.status = 'en_discovery'
  }

  await updateSDRProspecto(ctx.prospectId, updateData, client)

  await sender.enviarTexto(ctx.phone, respuesta)
  if (requires_founder_approval) {
    const bookingUrl = process.env['DEMO_BOOKING_URL']
    const followUp = bookingUrl
      ? `📅 Puedes elegir el horario aquí: ${bookingUrl}`
      : '¿Qué día y hora te queda mejor la próxima semana? 📅'
    await sender.enviarTexto(ctx.phone, followUp)
    trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: ctx.prospectId } })
  }

  await saveSDRInteraccion({
    prospecto_id: ctx.prospectId,
    phone: ctx.phone,
    turno: ctx.turnCount,
    tipo: 'inbound',
    contenido: textoOriginal,
    action_taken: nextFsmState,
    langfuse_trace_id: traceId,
  }, client)
}
