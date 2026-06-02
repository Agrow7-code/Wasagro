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
  const trace = langfuse.trace({ id: traceId })
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
    }
    if (client) routerCtx.client = client
    if (adapter) routerCtx.adapter = adapter

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
    console.error('[SDR] Error en handleSDRSession:', err)
    trace.event({ name: 'sdr_error', level: 'ERROR', input: { error: String(err) } })
    // Diplomatic recovery message — does NOT imply the system is broken or
    // mid-setup. Previous copy ("estamos terminando de configurar tu acceso")
    // appeared in real conversations and made the bot look half-finished to a
    // prospect that was about to convert. Keep it short, owning the hiccup,
    // inviting one retry.
    await sender.enviarTexto(msg.from, 'Disculpá, tuve un problemita procesando tu mensaje. ¿Me lo podés contar de nuevo? 🙏').catch(() => {})
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
    const followUp = bookingUrl
      ? `Perfecto — puedes agendar aquí: ${bookingUrl}`
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
      await sender.enviarTexto(msg.from, composed?.text ?? '¡Perfecto! Quedamos confirmados.')
      actionTaken = 'meeting_confirmed'
    } else if (intencion === 'wants_brochure') {
      const composed = compose('meeting_proposed', 'wants_brochure', ctxForTemplate)
      await sender.enviarTexto(msg.from, composed?.text ?? '¡Claro! Te mando el brochure ✅')
      actionTaken = 'brochure_sent'

      // Mantener el prospecto vivo en piloto_propuesto — el brochure es un nurture step,
      // no un descarte. El chaser job (20h) lo va a revisitar.
      await updateSDRProspecto(prospecto['id'] as string, { status: 'dormant' }, client)
    } else if (intencion === 'declined') {
      const composed = compose('meeting_proposed', 'declined', ctxForTemplate)
      await sender.enviarTexto(msg.from, composed?.text ?? 'Entiendo, no hay problema.')
      actionTaken = 'graceful_exit'
      await updateSDRProspecto(prospecto['id'] as string, { status: 'descartado' }, client)
    } else if (intencion === 'will_book_later') {
      const composed = compose('meeting_proposed', 'will_book_later', ctxForTemplate)
      await sender.enviarTexto(msg.from, composed?.text ?? '¡Perfecto, quedo a la espera!')
      actionTaken = 'meeting_pending'
    } else if (intencion === 'meeting_waiting') {
      const composed = compose('meeting_proposed', 'meeting_waiting', ctxForTemplate)
      await sender.enviarTexto(msg.from, composed?.text ?? '¡Perfecto! Un miembro del equipo se te une enseguida.')
      // 'meeting_confirmed' is the legal action_taken value matching the FSM
      // landing state (context.ts absorbs meeting_waiting -> meeting_confirmed).
      // Avoids introducing a new CHECK constraint value (FIX-7 lesson).
      actionTaken = 'meeting_confirmed'
    } else {
      // Intent 'other' - Respuesta conversacional amigable con el link
  const bookingUrl = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
  const followUp = bookingUrl
        ? `No estoy seguro de haberte entendido. Si quieres agendar la demostración, puedes elegir el horario directamente aquí: ${bookingUrl} ⏰`
        : '¿Cuándo tienes 30 minutos disponibles? Dime el día y la hora que mejor te quede.'
      await sender.enviarTexto(msg.from, followUp)
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
    console.error('[SDR] Error en handleMeetingConfirmation:', err)
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