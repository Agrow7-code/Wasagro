import { langfuse } from '../integrations/langfuse.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import {
  getSDRProspecto,
  createSDRProspecto,
  updateSDRProspecto,
  saveSDRInteraccion,
  getSDRProspectosPendingApproval,
  actualizarMensaje,
} from '../pipeline/supabaseQueries.js'
import { setIfNotExists } from '../integrations/redis.js'
import { scoreTerminalTransition } from './sdr/outcomeScoring.js'

const MAX_SDR_TURNS = 4 // Reducido para cerrar más rápido

const OBJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/no\s+ten(go|emos)\s+presupuesto|no\s+hay\s+plata|muy\s+caro|costoso/i, 'sin_presupuesto'],
  [/no\s+ten(go|emos)\s+tiempo|muy\s+ocupad/i, 'sin_tiempo'],
  [/ya\s+ten(go|emos)\s+(\w+\s+)?(sistema|app|software|herramienta)/i, 'tiene_sistema'],
  [/no\s+(estoy|estamos)\s+interesad/i, 'sin_interes'],
  [/necesito\s+pensar|lo\s+consulto|después\s+te\s+confirmo/i, 'posponer_decision'],
  [/no\s+(conozco|sé)\s+(el\s+)?EUDR|qué\s+es\s+EUDR/i, 'desconoce_eudr'],
  [/no\s+export|no\s+vendo\s+a\s+Europa/i, 'no_exporta'],
  [/solo\s+son\s+poc(as|os)\s+(hectáreas|ha|fincas)/i, 'operacion_pequena'],
  [/prefiero\s+WhatsApp\s+normal|no\s+quiero\s+otra\s+app/i, 'prefiere_whatsapp_normal'],
  [/desconfi|cómo\s+sé\s+que\s+es\s+confiable/i, 'desconfianza'],
]

export function detectarObjecion(texto: string): string | null {
  for (const [pattern, type] of OBJECTION_PATTERNS) {
    if (pattern.test(texto)) return type
  }
  return null
}

function calcularPrecio(segmento_icp: string, fincas: number): string {
  if (segmento_icp === 'exportadora') return 'Tenemos planes personalizados para operaciones grandes. Nos gustaría hacer una videollamada para entender tu volumen y armarte una propuesta a medida.'
  if (segmento_icp === 'ong') return 'Manejamos precios especiales con descuento para organizaciones sin fines de lucro. Hablemos unos minutos para cotizarte el alcance exacto.'
  return 'Es un costo variable según el tamaño de tu finca y las hectáreas activas. Lo mejor es agendar una breve llamada para darte el precio exacto.'
}

// Pick the brochure slug for this prospect.
// Source of truth: prospecto['segmento_icp'] which was set by detectRoleFromText
// in the SDR router based on what the prospect explicitly said about themselves.
// Size (fincas/hectáreas) is NOT used here anymore — a smallholder with 30 ha
// who said "tengo mi propia finca" is an agricultor, not an exportadora.
// If no role was ever detected (segmento_icp = 'desconocido'), default to
// agricultor — that's the safer copy for any prospect we can't classify.
import { segmentoToBrochureSlug } from './sdr/roleDetector.js'
import type { Segmento } from './sdr/context.js'
import { getClassifier } from './sdr/classifier.js'
import { loadHydratedContext } from './sdr/contextStore.js'
import { compose } from './sdr/composer.js'
import { safePersist } from './sdr/router.js'
import type { ILLMAdapter } from '../integrations/llm/ILLMAdapter.js'

export function inferBrochureSegment(prospecto: Record<string, unknown>): 'exportadora' | 'agricultor' {
  const seg = (prospecto['segmento_icp'] as Segmento | undefined) ?? 'desconocido'
  return segmentoToBrochureSlug(seg)
}

export function detectarHandoffTrigger(texto: string, turno: number): 'human_request' | 'price_readiness' | null {
  if (/hablar\s+con\s+alguien|hablar\s+con\s+ustedes|hablar\s+con\s+el\s+equipo|persona\s+real|hablar\s+directamente/i.test(texto)) {
    return 'human_request'
  }
  if (turno > 3 && /cu[aá]nto\s+cuesta|qu[eé]\s+precio\s+tienen|cu[aá]nto\s+es/i.test(texto)) {
    return 'price_readiness'
  }
  return null
}

export async function handleSDRSession(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  llm: IWasagroLLM,
  client?: SupabaseClient,
  adapter?: ILLMAdapter,
): Promise<void> {
  // Trace SDR enriquecido: tags por pipeline + tipo media. metadata del prospecto
  // se rellena después de hidratar (puede no existir aún en el primer turno).
  const trace = langfuse.trace({
    id:       traceId,
    name:     'sdr_pipeline',
    tags:     ['sdr', msg.tipo],
    metadata: { phone: msg.from, wamid: msg.wamid },
  })
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : '[mensaje de voz o imagen]'

  try {
    let prospecto = await getSDRProspecto(msg.from, client) as Record<string, unknown> | null
    let isNuevoProspecto = false

    if (!prospecto) {
      const narrativa: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B'
      
      let sourceContext = msg.source_context
      if (!sourceContext && msg.tipo === 'texto') {
        const txtNormalizado = texto.toLowerCase().trim()
        if (txtNormalizado.includes('quiero empezar con wasagro') || 
            txtNormalizado.includes('no tengo acceso a wasagro') || 
            txtNormalizado === 'hola wasagro') {
          sourceContext = 'Tráfico Orgánico - Landing Page'
        }
      }

      prospecto = await createSDRProspecto({ 
        phone: msg.from, 
        narrativa_asignada: narrativa,
        source_context: sourceContext ?? null
      }, client)
      isNuevoProspecto = true
      trace.event({ name: 'sdr_prospecto_created', input: { phone: msg.from, narrativa, source_context: sourceContext } })
    }

    if (isNuevoProspecto) {
      trace.event({
        name: 'sdr_session_started',
        input: {
          narrativa: prospecto['narrativa_asignada'],
          segmento_icp: prospecto['segmento_icp'],
          source_context: prospecto['source_context'],
        },
      })
    }

    // Delegate to FSM Node Router
    const { routeSDRNode } = await import('./sdr/router.js')
    
    const routerCtx: any = {
      prospecto,
      textoOriginal: texto,
      traceId,
      llm,
      sender,
      mediaType: msg.tipo,
      mensajeId,
    }
    if (client) routerCtx.client = client
    if (adapter) routerCtx.adapter = adapter
    if (msg.tipo === 'audio') {
      // SDR audio transcription: thread through what handleAudioInbound needs
      // to resolve the audio bytes for STT (D4), mirroring EventHandler.ts's
      // field-capture audio path.
      routerCtx.audioUrl = msg.audioUrl
      routerCtx.mediaId = msg.mediaId
      routerCtx.rawPayload = msg.rawPayload
    }

    await routeSDRNode(routerCtx)

    // Enqueue sdr_chaser job (20h delay)
    try {
      const { getBoss, isPgBossReady } = await import('../workers/pgBoss.js')
      if (isPgBossReady()) {
        const boss = getBoss()
        const nuevoTurno = (prospecto['turns_total'] as number) + 1
        await boss.send('sdr-chaser', {
          prospecto_id: prospecto['id'],
          expected_turn: nuevoTurno
        }, { startAfter: 20 * 3600 })
      }
    } catch (bossErr) {
      console.warn('[SDR] No se pudo encolar chaser:', bossErr)
    }

    await actualizarMensaje(mensajeId, { status: 'processed' })
  } catch (err) {
    // CRÍTICO: diagnóstico rico. Real-prospect bug 2026-06-06: el mensaje
    // "tuve un problemita" salió DOS veces en la misma conversación y el
    // prospecto se fue. La causa raíz (status DB invalida, columna missing,
    // LLM timeout, etc.) cambia turno a turno. Necesitamos capturar el
    // stack trace + última operación para identificarla en LangFuse.
    const errorDetail = {
      message: err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
      name:    err instanceof Error ? err.name : undefined,
      phone:   msg.from,
      wamid:   msg.wamid,
      tipo:    msg.tipo,
    }
    console.error('[SDR] Error en handleSDRSession:', errorDetail)
    trace.event({ name: 'sdr_error', level: 'ERROR', input: errorDetail })

    // Dedup del recovery message: bug visto en prod — el mensaje "tuve un
    // problemita" salía cada turno con error consecutivo, y el cliente se
    // hartaba ("dos veces repetir un mensaje hace perder clientes"). Redis
    // key TTL 5 min: solo enviamos UN recovery cada 5min por phone. Si la
    // pipeline sigue rota, el prospecto queda en silencio (el next msg
    // intentará procesarse normal) — peor el remedio que la enfermedad.
    let shouldSendRecovery = true
    try {
      const recoveryDedupOk = await setIfNotExists(`sdr_recovery_sent:${msg.from}`, 300)
      if (!recoveryDedupOk) {
        shouldSendRecovery = false
        trace.event({
          name:  'sdr_recovery_dedup_skipped',
          level: 'WARNING',
          input: { phone: msg.from, reason: 'recovery_already_sent_in_5min_window' },
        })
      }
    } catch (dedupErr) {
      // Si Redis cae, degrade a enviar (mejor enviar repetido que dejar al
      // user en silencio cuando es el primer error real). Logueamos.
      console.warn('[SDR] recovery dedup failed, enviando igual:', dedupErr)
    }

    if (shouldSendRecovery) {
      // Diplomatic recovery — owns the hiccup, invita a UN retry.
      await sender.enviarTexto(msg.from, 'Disculpá, tuve un problemita procesando tu mensaje. ¿Me lo podés contar de nuevo? 🙏').catch(() => {})
    }
    await actualizarMensaje(mensajeId, { status: 'error', error_detail: String(err) }).catch(() => {})
  }
}

export async function handleFounderApproval(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  client?: SupabaseClient,
): Promise<boolean> {
  try {
    const pendientes = await getSDRProspectosPendingApproval(client)
    if (pendientes.length === 0) return false

    const prospecto = pendientes[0]!
    const trace = langfuse.trace({ id: traceId })
    const texto = (msg.texto ?? '').trim()

    const isSi = /^(sí|si|s|yes|ok|dale|listo|confirmo|apruebo|envía|envia)[\s!.]*$/i.test(texto)
    const isNo = /^(no|rechaz|descartar|cancelar|no\s+enviar)[\s!.]*$/i.test(texto)

    let mensajeAlProspecto: string | null = null
    let nuevoStatus: string
    let actionTaken: string
    let tipoInteraccion: 'draft_approval' | 'founder_override'

    if (isSi) {
      const dealBrief = prospecto['deal_brief'] as Record<string, unknown> | null
      mensajeAlProspecto = (dealBrief?.['draft_message'] as string | null) ?? null
      nuevoStatus = 'piloto_propuesto'
      actionTaken = 'send_approved_draft'
      tipoInteraccion = 'draft_approval'
    } else if (isNo) {
      nuevoStatus = 'descartado'
      actionTaken = 'graceful_exit'
      tipoInteraccion = 'draft_approval'
    } else {
      mensajeAlProspecto = texto
      nuevoStatus = 'piloto_propuesto'
      actionTaken = 'founder_override'
      tipoInteraccion = 'founder_override'
    }

    if (mensajeAlProspecto) {
      await sender.enviarTexto(prospecto['phone'] as string, mensajeAlProspecto)

      if (isSi || !isNo) {
        const bookingUrl = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
        const prospectoId = prospecto['id'] as string
        const urlWithParam = bookingUrl ? `${bookingUrl}?prospecto_id=${encodeURIComponent(prospectoId)}` : ''
        const followUp = urlWithParam
          ? `Perfecto — puedes agendar aquí: ${urlWithParam}`
          : 'Perfecto — ¿cuándo tienes 20 minutos disponibles?'
        await sender.enviarTexto(prospecto['phone'] as string, followUp)
  }

      trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: prospecto['id'], narrativa: prospecto['narrativa_asignada'] } })
    }

    const updatePayload: Record<string, unknown> = { status: nuevoStatus }
  if ((isSi || !isNo) && (process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL'])) {
    updatePayload.calendar_link_sent_at = new Date().toISOString()
  }
  await updateSDRProspecto(prospecto['id'] as string, updatePayload, client)

    await saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: msg.from,
      turno: (prospecto['turns_total'] as number) + 1,
      tipo: tipoInteraccion,
      contenido: texto,
      action_taken: actionTaken,
      langfuse_trace_id: traceId,
    }, client)

    const founderConfirm = isSi
      ? `✅ Propuesta enviada a ${(prospecto['nombre'] as string | null) ?? (prospecto['phone'] as string)}.`
      : isNo
      ? `❌ Prospecto descartado.`
      : `✅ Tu mensaje fue enviado a ${(prospecto['nombre'] as string | null) ?? (prospecto['phone'] as string)}.`

  await sender.enviarTexto(msg.from, founderConfirm)
  trace.event({ name: 'sdr_founder_approval', input: { prospecto_id: prospecto['id'], action: actionTaken } })

  // D24: Enqueue booking reminder (24h) when calendar link was sent
  if ((isSi || !isNo) && (process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL'])) {
    try {
      const { getBoss, isPgBossReady } = await import('../workers/pgBoss.js')
      if (isPgBossReady()) {
        const boss = getBoss()
        await boss.send('sdr-chaser', {
          prospecto_id: prospecto['id'],
          expected_turn: (prospecto['turns_total'] as number) + 1,
          reminder_type: 'booking',
        }, { startAfter: 24 * 3600 })
      }
    } catch (bossErr) {
      console.warn('[SDR] No se pudo encolar booking reminder:', bossErr)
    }
  }

  await actualizarMensaje(mensajeId, { status: 'processed' })

    return true
  } catch (err) {
    console.error('[SDR] Error en handleFounderApproval:', err)
    return false
  }
}

const MEETING_CONFIRMATION_PATTERNS: RegExp[] = [
  /ya\s+agend[eé]/i,
  /confirm[oó]\s*(la\s+)?reuni[oó]n/i,
  /(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+a\s+las\s+\d/i,
  /ma[nñ]ana\s+a\s+las\s+\d/i,
  /(el\s+)?\d{1,2}\s+de\s+\w+\s+a\s+las/i,
]

export function detectarConfirmacionReunion(texto: string): boolean {
  return MEETING_CONFIRMATION_PATTERNS.some(p => p.test(texto))
}

export async function handleMeetingConfirmation(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  llm: IWasagroLLM,
  client?: SupabaseClient,
  adapter?: ILLMAdapter,
): Promise<boolean> {
  try {
    const prospecto = await getSDRProspecto(msg.from, client) as Record<string, unknown> | null
    if (!prospecto || prospecto['status'] !== 'piloto_propuesto') return false

    const trace = langfuse.trace({ id: traceId })
    const texto = (msg.texto ?? '').trim()

    // Fase B classifier: hydrate ConvContext (Redis-backed) and run the typed
    // intent classifier. Falls back to the legacy clasificarIntencionSDR path
    // only when no adapter was wired (tests / very-old call sites). The new
    // path returns a typed Intent that already includes the categories we
    // need here (wants_brochure / booked / will_book_later / declined).
    let intencion: string
    if (adapter) {
      const initial = await loadHydratedContext(prospecto)
      const classifier = getClassifier(adapter)
      const result = await classifier.classify(texto, initial.ctx, traceId)
      intencion = result.intent
    } else {
      const opciones = ['wants_brochure', 'booked', 'will_book_later', 'declined', 'other'] as const
      intencion = await llm.clasificarIntencionSDR(
        texto,
        opciones,
        'El usuario acaba de recibir una invitación a agendar una videollamada o pedir un brochure por segmento. Variantes válidas para "wants_brochure": "envíame pdf", "mandame el brochure", "info", "quiero leerlo primero".',
        traceId,
      )
    }

    let actionTaken = 'meeting_pending'
    // The bot's own reply for this turn — captured so it can be persisted as
    // tipo='outbound' below. Real-prod misattribution bug (phone
    // 573108059563): these replies were sent via sender.enviarTexto(...) but
    // never persisted, so Wasagro's side of the founder-crm thread was
    // missing entirely (getConversacionThread only ever saw the prospect's
    // inbound/meeting_confirmation rows).
    let respuestaAlProspecto = ''

    // Fase A: structural responses come from deterministic templates. The
    // composer resolves by intent (these are all high-priority intent overrides
    // in the registry), so the state arg is informational only.
    const ctxForTemplate = (await loadHydratedContext(prospecto)).ctx

    if (intencion === 'booked') {
      const reunionAgendadaAt = new Date().toISOString()
      await updateSDRProspecto(prospecto['id'] as string, {
        status: 'reunion_agendada',
        reunion_agendada_at: reunionAgendadaAt,
      }, client)

      trace.event({
        name: 'sdr_meeting_scheduled',
        input: { prospecto_id: prospecto['id'], narrativa: prospecto['narrativa_asignada'], phone: prospecto['phone'] },
      })

      const composed = compose('meeting_proposed', 'booked', ctxForTemplate)
      respuestaAlProspecto = composed?.text ?? '¡Perfecto! Quedamos confirmados.'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
      actionTaken = 'meeting_confirmed'
    } else if (intencion === 'wants_brochure') {
      const composed = compose('meeting_proposed', 'wants_brochure', ctxForTemplate)
      respuestaAlProspecto = composed?.text ?? '¡Claro! Te mando el brochure ✅'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
      actionTaken = 'brochure_sent'

      // Mantener el prospecto vivo en piloto_propuesto — el brochure es un nurture step,
      // no un descarte. El chaser job (20h) lo va a revisitar.
      await updateSDRProspecto(prospecto['id'] as string, { status: 'dormant' }, client)
    } else if (intencion === 'declined') {
      const composed = compose('meeting_proposed', 'declined', ctxForTemplate)
      respuestaAlProspecto = composed?.text ?? 'Entiendo, no hay problema.'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
      actionTaken = 'graceful_exit'
      await updateSDRProspecto(prospecto['id'] as string, { status: 'descartado' }, client)
    } else if (intencion === 'will_book_later') {
      const composed = compose('meeting_proposed', 'will_book_later', ctxForTemplate)
      respuestaAlProspecto = composed?.text ?? '¡Perfecto, quedo a la espera!'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
      actionTaken = 'meeting_pending'
    } else if (intencion === 'meeting_waiting') {
      const composed = compose('meeting_proposed', 'meeting_waiting', ctxForTemplate)
      respuestaAlProspecto = composed?.text ?? '¡Perfecto! Un miembro del equipo se te une enseguida.'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
      // 'meeting_confirmed' is the legal action_taken value matching the FSM
      // landing state (context.ts absorbs meeting_waiting -> meeting_confirmed).
      // Avoids introducing a new CHECK constraint value (FIX-7 lesson).
      actionTaken = 'meeting_confirmed'
    } else {
      // Intent 'other' - Respuesta conversacional amigable con el link
      const bookingUrl = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
      const prospectoId = prospecto['id'] as string
      const urlWithParam = bookingUrl ? `${bookingUrl}?prospecto_id=${encodeURIComponent(prospectoId)}` : ''
      respuestaAlProspecto = urlWithParam
        ? `No estoy seguro de haberte entendido. Si quieres agendar la demostración, puedes elegir el horario directamente aquí: ${urlWithParam} ⏰`
        : '¿Cuándo tienes 30 minutos disponibles? Dime el día y la hora que mejor te quede.'
      await sender.enviarTexto(msg.from, respuestaAlProspecto)
    }

    // Persist the bot's own reply as tipo='outbound' — best-effort (never
    // breaks the flow), matching the same content that was actually sent so
    // PR5's fromMe echo dedup (exact content match) recognizes it as our own
    // send instead of logging it as a founder manual reply.
    await safePersist(() => saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: msg.from,
      turno: (prospecto['turns_total'] as number) + 1,
      tipo: 'outbound',
      contenido: respuestaAlProspecto,
      action_taken: null,
      langfuse_trace_id: traceId,
    }, client), {
      trace,
      eventName: 'sdr_outbound_interaccion_save_failed',
      meta: { prospecto_id: prospecto['id'], path: 'meeting_confirmation' },
    })

    // SDR funnel scoring: convert handler-level actionTaken → FSM-equivalent
    // terminal state and emit score. Only fires when the prospect actually
    // landed in a terminal outcome (booked/declined). The other branches
    // (wants_brochure, will_book_later, other) leave the prospect in
    // meeting_proposed and don't get scored — they're still in-flight.
    const terminalTo = actionTaken === 'meeting_confirmed'
      ? 'meeting_confirmed' as const
      : actionTaken === 'graceful_exit'
        ? 'declined' as const
        : null
    if (terminalTo) {
      scoreTerminalTransition(trace, 'meeting_proposed', terminalTo, {
        prospectoId: prospecto['id'] as string,
        phone:       msg.from,
        narrativa:   (prospecto['narrativa_asignada'] as string | null) ?? null,
        cultivo:     (prospecto['cultivo_principal'] as string | null) ?? null,
        segmento:    (prospecto['segmento_icp'] as string | null) ?? null,
        turnCount:   (prospecto['turns_total'] as number) + 1,
        source:      'meeting_confirmation',
      })
    }

    await saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: msg.from,
      turno: (prospecto['turns_total'] as number) + 1,
      tipo: 'meeting_confirmation',
      contenido: texto,
      action_taken: actionTaken,
      langfuse_trace_id: traceId,
    }, client)

    await actualizarMensaje(mensajeId, { status: 'processed' })
    return true
  } catch (err) {
    // AGENTS.md Rule 4: todo error queda registrado en observabilidad. Antes
    // este catch solo loggeaba a console; ahora también emite a LangFuse con
    // stack + diagnóstico (mismo patrón que handleSDRSession).
    const detail = {
      message: err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
      name:    err instanceof Error ? err.name : undefined,
      phone:   msg.from,
      wamid:   msg.wamid,
    }
    console.error('[SDR] Error en handleMeetingConfirmation:', detail)
    try {
      langfuse.trace({ id: traceId }).event({
        name:  'sdr_meeting_confirmation_error',
        level: 'ERROR',
        input: detail,
      })
    } catch {
      // langfuse client falla → degrade silencioso, ya loggeamos a console
    }
    return false
  }
}

function buildFounderNotification(
  prospecto: Record<string, unknown>,
  draftMessage: string,
  brief: Record<string, unknown> | null,
): string {
  const segmento = String(brief?.['segmento_icp'] ?? prospecto['segmento_icp'] ?? 'desconocido')
  const narrativa = String(prospecto['narrativa_asignada'] ?? '?')
  const nombre = String(prospecto['nombre'] ?? prospecto['phone'])
  const empresa = prospecto['empresa'] ? String(prospecto['empresa']) : null
  const pais = brief?.['pais'] ? String(brief['pais']) : null
  const cultivo = brief?.['cultivo_principal'] ? String(brief['cultivo_principal']) : null
  const fincas = brief?.['fincas_en_cartera'] != null ? String(brief['fincas_en_cartera']) : '?'
  const sistemaActual = brief?.['sistema_actual'] ? String(brief['sistema_actual']) : 'desconocido'
  const objeciones = (prospecto['objeciones_manejadas'] as string[] | null) ?? []
  const objecionesStr = objeciones.length > 0 ? objeciones.join(', ') : 'ninguna'

  const lines = [
    '⚡ LEAD CALIFICADO — Wasagro SDR',
    '',
    `${segmento} | ${narrativa}`,
    '',
    `👤 ${nombre}`,
  ]

  if (empresa) lines.push(`🏢 ${empresa}`)

  const sourceCtx = (brief?.['source_context'] as string | undefined) ?? (prospecto['source_context'] as string | null)
  if (sourceCtx) lines.push(`🔗 Origen: ${sourceCtx}`)

  const ubicacion = [pais, cultivo].filter(Boolean).join(' | ')
  if (ubicacion) lines.push(`📍 ${ubicacion}`)

  lines.push(`🌾 ${fincas} fincas/hectáreas`)
  lines.push(`📋 Sistema actual: ${sistemaActual}`)
  lines.push(`Objeciones manejadas: ${objecionesStr}`)
  lines.push('')
  lines.push('─────────────────────────────')
  lines.push('MENSAJE ENVIADO AL PROSPECTO:')
  lines.push('')
  lines.push(draftMessage)
  lines.push('')
  lines.push('─────────────────────────────')
  lines.push('Demo agendado automáticamente. ✅')

  return lines.join('\n')
}