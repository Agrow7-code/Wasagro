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

// Map a prospect to one of the brochures we actually have ("exportadora" or "agricultor").
// Brochures live at WASAGRO_BROCHURE_URL?segment=<segmento>.
// Rule: >=10 fincas/hectáreas OR already classified as exportadora/ong → exportadora.
// Default (agricultor con pocas fincas o desconocido) → agricultor.
export function inferBrochureSegment(prospecto: Record<string, unknown>): 'exportadora' | 'agricultor' {
  const seg = prospecto['segmento_icp'] as string | undefined
  if (seg === 'exportadora' || seg === 'ong') return 'exportadora'
  const fincas = prospecto['fincas_en_cartera']
  if (typeof fincas === 'number' && fincas >= 10) return 'exportadora'
  return 'agricultor'
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
    }
    if (client) routerCtx.client = client

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
    await sender.enviarTexto(msg.from, 'Hola. Soy Wasagro, tu asistente de campo. En este momento estamos terminando de configurar tu acceso. Por favor intenta escribirnos de nuevo en un momento. 🚜')
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
        const bookingUrl = process.env['DEMO_BOOKING_URL']
        const followUp = bookingUrl
          ? `Perfecto — puedes agendar aquí: ${bookingUrl}`
          : 'Perfecto — ¿cuándo tienes 20 minutos disponibles?'
        await sender.enviarTexto(prospecto['phone'] as string, followUp)
      }

      trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: prospecto['id'], narrativa: prospecto['narrativa_asignada'] } })
    }

    await updateSDRProspecto(prospecto['id'] as string, { status: nuevoStatus }, client)

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
): Promise<boolean> {
  try {
    const prospecto = await getSDRProspecto(msg.from, client) as Record<string, unknown> | null
    if (!prospecto || prospecto['status'] !== 'piloto_propuesto') return false

    const trace = langfuse.trace({ id: traceId })
    const texto = (msg.texto ?? '').trim()

    // Clasificar intención post-pitch. Usar el clasificador JSON real, no el writer
    // (el writer está configurado en responseFormat: 'text' y el prompt SP-SDR-03
    // dice "NO uses JSON" — esa contradicción rompía silenciosamente el parse).
    const opciones = ['wants_brochure', 'booked', 'will_book_later', 'declined', 'other'] as const
    const intencion = await llm.clasificarIntencionSDR(
      texto,
      opciones,
      'El usuario acaba de recibir una invitación a agendar una videollamada o pedir un brochure por segmento. Variantes válidas para "wants_brochure": "envíame pdf", "mandame el brochure", "info", "quiero leerlo primero".',
      traceId,
    )

    let actionTaken = 'meeting_pending'
    
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

      await sender.enviarTexto(msg.from, '¡Perfecto! Quedamos confirmados. Te escribimos antes para recordarte. ✅')
      actionTaken = 'meeting_confirmed'
    } else if (intencion === 'wants_brochure') {
      const segment = inferBrochureSegment(prospecto)
      const brochureBase = process.env['WASAGRO_BROCHURE_URL'] ?? 'https://wasagro.vercel.app/brochure'
      const brochureUrl = `${brochureBase}?segment=${segment}`
      await sender.enviarTexto(
        msg.from,
        `¡Claro! Aquí tienes el brochure pensado para tu perfil de ${segment}: ${brochureUrl}\n\nDale una mirada y cualquier duda me avisas por acá. ✅`,
      )
      actionTaken = 'brochure_sent'

      // Mantener el prospecto vivo en piloto_propuesto — el brochure es un nurture step,
      // no un descarte. El chaser job (20h) lo va a revisitar.
      await updateSDRProspecto(prospecto['id'] as string, { status: 'dormant' }, client)
    } else if (intencion === 'declined') {
      await sender.enviarTexto(msg.from, 'Entiendo, no hay problema. Si en algún momento quieres simplificar tu operación agrícola, aquí estaremos. ¡Un saludo! 👋')
      actionTaken = 'graceful_exit'
      await updateSDRProspecto(prospecto['id'] as string, { status: 'descartado' }, client)
    } else if (intencion === 'will_book_later') {
      await sender.enviarTexto(msg.from, '¡Perfecto, quedo a la espera! Cuando tengas un ratito, me avisas o usas el link que te mandé. ⏰')
      actionTaken = 'meeting_pending'
    } else {
      // Intent 'other' - Respuesta conversacional amigable con el link
      const bookingUrl = process.env['DEMO_BOOKING_URL']
      const followUp = bookingUrl
        ? `No estoy seguro de haberte entendido. Si quieres agendar la demostración, puedes elegir el horario directamente aquí: ${bookingUrl} ⏰`
        : '¿Cuándo tienes 10 minutos disponibles? Dime el día y la hora que mejor te quede.'
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