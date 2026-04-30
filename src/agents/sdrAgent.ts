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
import type { EntradaSDR, PreguntaRealizada, ScoreDimensions } from '../types/dominio/SDRTypes.js'

const MAX_SDR_TURNS = 10

const SCORE_MAX: Record<keyof ScoreDimensions, number> = {
  eudr_urgency: 25,
  tamano_cartera: 20,
  calidad_dato: 20,
  champion: 15,
  timeline_decision: 10,
  presupuesto: 10,
}

const SCORE_DIMS = ['eudr_urgency', 'tamano_cartera', 'calidad_dato', 'champion', 'timeline_decision', 'presupuesto'] as const

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

// REQ-hand-001: text-based handoff triggers (score_threshold is handled separately)
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
      prospecto = await createSDRProspecto({ phone: msg.from, narrativa_asignada: narrativa }, client)
      isNuevoProspecto = true
      trace.event({ name: 'sdr_prospecto_created', input: { phone: msg.from, narrativa } })
    }

    // REQ-narr-005: sdr_session_started fires on new prospect
    if (isNuevoProspecto) {
      trace.event({
        name: 'sdr_session_started',
        input: {
          narrativa: prospecto['narrativa_asignada'],
          segmento_icp: prospecto['segmento_icp'],
        },
      })
    }

    const objection_detected = detectarObjecion(texto)

    const scores: ScoreDimensions = {
      eudr_urgency: prospecto['score_eudr_urgency'] as number,
      tamano_cartera: prospecto['score_tamano_cartera'] as number,
      calidad_dato: prospecto['score_calidad_dato'] as number,
      champion: prospecto['score_champion'] as number,
      timeline_decision: prospecto['score_timeline_decision'] as number,
      presupuesto: prospecto['score_presupuesto'] as number,
    }

    const preguntasRealizadas = (prospecto['preguntas_realizadas'] as PreguntaRealizada[]) ?? []

    const entrada: EntradaSDR = {
      mensaje: texto,
      prospecto: {
        nombre: prospecto['nombre'] as string | null,
        empresa: prospecto['empresa'] as string | null,
        segmento_icp: prospecto['segmento_icp'] as string,
        narrativa: prospecto['narrativa_asignada'] as 'A' | 'B',
        score_total: prospecto['score_total'] as number,
        scores_por_dimension: scores,
        preguntas_realizadas: preguntasRealizadas,
        objeciones_manejadas: (prospecto['objeciones_manejadas'] as string[]) ?? [],
        punto_de_dolor_principal: prospecto['punto_de_dolor_principal'] as string | null,
      },
      narrativa: prospecto['narrativa_asignada'] as 'A' | 'B',
      preguntas_realizadas: preguntasRealizadas,
      score_actual: prospecto['score_total'] as number,
      turno: (prospecto['turns_total'] as number) + 1,
      objection_detected,
      segmento_icp: prospecto['segmento_icp'] as string,
    }

    // REQ-hand-001: detect text-based handoff trigger before calling LLM
    const preHandoffTrigger = detectarHandoffTrigger(texto, entrada.turno)

    const rawResultado = await llm.atenderSDR(entrada, traceId)
    // Shallow copy so we never mutate the LLM response object (critical for test isolation)
    const resultado = {
      ...rawResultado,
      score_delta: { ...rawResultado.score_delta },
    }

    // REQ-hand-001: force propose_pilot when text-based trigger detected
    if (preHandoffTrigger && resultado.action !== 'propose_pilot' && resultado.action !== 'graceful_exit') {
      resultado.action = 'propose_pilot'
      resultado.requires_founder_approval = true
      const brief = { ...((resultado.deal_brief as Record<string, unknown>) ?? {}), handoff_trigger: preHandoffTrigger }
      resultado.deal_brief = brief
    }

    // Regla 2: hard cap — never loop past MAX_SDR_TURNS turns
    if (resultado.action === 'continue_discovery' && entrada.turno >= MAX_SDR_TURNS) {
      resultado.action = 'graceful_exit'
      resultado.respuesta = 'Gracias por tu tiempo. Si en algún momento quieres retomar la conversación, aquí estaremos. ✅'
    }

    // REQ-qual-009: evidence-gated score validation — reject non-zero deltas without evidence_quote
    const invalidEvidence = resultado.preguntas_respondidas.some(p => p.score_delta !== 0 && p.evidence_quote === null)
    if (invalidEvidence) {
      trace.event({
        name: 'sdr_evidence_validation_error',
        input: { preguntas: resultado.preguntas_respondidas.filter(p => p.score_delta !== 0 && p.evidence_quote === null) },
      })
      for (const dim of SCORE_DIMS) {
        resultado.score_delta[dim] = 0
      }
    }

    const nuevosDimensions: Record<string, number> = {}
    for (const dim of SCORE_DIMS) {
      const current = scores[dim]
      const d = (resultado.score_delta[dim] ?? 0)
      nuevosDimensions[`score_${dim}`] = Math.min(SCORE_MAX[dim], Math.max(current, current + d))
    }

    const preguntasExistentes = new Set(preguntasRealizadas.map(p => p.question_id))
    const nuevasPreguntas = resultado.preguntas_respondidas.filter(p => !preguntasExistentes.has(p.question_id))
    const preguntasActualizadas = [
      ...preguntasRealizadas,
      ...nuevasPreguntas.map(p => ({
        question_id: p.question_id,
        question_text: p.question_id,
        answer_text: p.answer_text,
        dimension: p.dimension,
        score_delta: p.score_delta,
        evidence_quote: p.evidence_quote,
        turn: entrada.turno,
        answered_at: new Date().toISOString(),
      })),
    ]

    const objecionesActuales = (prospecto['objeciones_manejadas'] as string[]) ?? []
    const nuevasObjeciones = objection_detected && !objecionesActuales.includes(objection_detected)
      ? [...objecionesActuales, objection_detected]
      : objecionesActuales

    const nuevoTurno = (prospecto['turns_total'] as number) + 1
    let nuevoStatus = prospecto['status'] === 'new' ? 'en_discovery' : (prospecto['status'] as string)
    let dealBriefParaGuardar: unknown = prospecto['deal_brief']
    let founderNotifiedAt: string | null = prospecto['founder_notified_at'] as string | null

    if (resultado.action === 'graceful_exit') {
      nuevoStatus = 'unqualified'
      await sender.enviarTexto(msg.from, resultado.respuesta)
    } else if (resultado.action === 'propose_pilot' || resultado.requires_founder_approval) {
      nuevoStatus = 'piloto_propuesto'
      dealBriefParaGuardar = {
        ...((resultado.deal_brief as object) ?? {}),
        draft_message: resultado.respuesta,
      }
      founderNotifiedAt = new Date().toISOString()

      // Send demo invitation directly to prospect — no founder gate (Option A)
      await sender.enviarTexto(msg.from, resultado.respuesta)
      const bookingUrl = process.env['DEMO_BOOKING_URL']
      const followUp = bookingUrl
        ? `📅 Puedes agendar aquí: ${bookingUrl}`
        : '¿Cuándo tienes 20 minutos disponibles para una llamada rápida? Dime el día y la hora que mejor te quede. 📅'
      await sender.enviarTexto(msg.from, followUp)

      // Notify founder informatively only — no approval gate
      const founderPhone = process.env['FOUNDER_PHONE']
      if (founderPhone) {
        const brief = resultado.deal_brief as Record<string, unknown> | null
        await sender.enviarTexto(founderPhone, buildFounderNotification(
          prospecto,
          resultado.respuesta,
          brief,
        ))
      }

      trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: prospecto['id'], phone: prospecto['phone'] } })
    } else {
      await sender.enviarTexto(msg.from, resultado.respuesta)
    }

    const scoreAfter = SCORE_DIMS.reduce((sum, dim) => sum + (nuevosDimensions[`score_${dim}`] ?? 0), 0)

    // REQ-narr-005: fire A/B tracking events
    if (resultado.action === 'propose_pilot' || resultado.requires_founder_approval) {
      trace.event({
        name: 'sdr_qualified',
        input: {
          narrativa: prospecto['narrativa_asignada'],
          segmento_icp: prospecto['segmento_icp'],
          score_total: scoreAfter,
          turns_to_qualify: nuevoTurno,
        },
      })
    } else if (resultado.action === 'graceful_exit') {
      trace.event({
        name: 'sdr_unqualified',
        input: {
          narrativa: prospecto['narrativa_asignada'],
          segmento_icp: prospecto['segmento_icp'],
          score_total: scoreAfter,
          exit_reason: entrada.turno >= MAX_SDR_TURNS ? 'max_turns' : 'no_qualify',
        },
      })
    }

    // REQ-disc-003: persist segmento_icp if LLM updated it
    const segmentoUpdate = resultado.segmento_icp ? { segmento_icp: resultado.segmento_icp } : {}

    await updateSDRProspecto(prospecto['id'] as string, {
      ...nuevosDimensions,
      ...segmentoUpdate,
      preguntas_realizadas: preguntasActualizadas,
      objeciones_manejadas: nuevasObjeciones,
      status: nuevoStatus,
      turns_total: nuevoTurno,
      deal_brief: dealBriefParaGuardar,
      founder_notified_at: founderNotifiedAt,
    }, client)

    // REQ-qual-009: skip interaction log when evidence validation failed
    if (!invalidEvidence) {
      await saveSDRInteraccion({
        prospecto_id: prospecto['id'],
        phone: msg.from,
        turno: nuevoTurno,
        tipo: 'inbound',
        contenido: texto,
        score_before: prospecto['score_total'],
        score_after: scoreAfter,
        score_delta: resultado.score_delta,
        objection_detected,
        action_taken: resultado.action,
        narrativa: prospecto['narrativa_asignada'],
        segmento_icp: prospecto['segmento_icp'],
        langfuse_trace_id: traceId,
      }, client)
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

    // pendientes.length > 0 is guaranteed above — non-null assertion is safe
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

      // REQ-hand-006: send booking link or availability question after pilot proposal
      if (isSi || !isNo) {
        const bookingUrl = process.env['DEMO_BOOKING_URL']
        const followUp = bookingUrl
          ? `Perfecto — puedes agendar aquí: ${bookingUrl}`
          : 'Perfecto — ¿cuándo tienes 20 minutos disponibles?'
        await sender.enviarTexto(prospecto['phone'] as string, followUp)
      }

      // REQ-narr-005: sdr_pilot_proposed fires when draft is sent to prospect
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

// REQ-hand-006: handles prospect messages when status = 'piloto_propuesto'
export async function handleMeetingConfirmation(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  client?: SupabaseClient,
): Promise<boolean> {
  try {
    const prospecto = await getSDRProspecto(msg.from, client) as Record<string, unknown> | null
    if (!prospecto || prospecto['status'] !== 'piloto_propuesto') return false

    const trace = langfuse.trace({ id: traceId })
    const texto = (msg.texto ?? '').trim()
    const isMeetingConfirmed = detectarConfirmacionReunion(texto)

    if (isMeetingConfirmed) {
      const reunionAgendadaAt = new Date().toISOString()
      await updateSDRProspecto(prospecto['id'] as string, {
        status: 'reunion_agendada',
        reunion_agendada_at: reunionAgendadaAt,
      }, client)

      trace.event({
        name: 'sdr_meeting_scheduled',
        input: {
          prospecto_id: prospecto['id'],
          narrativa: prospecto['narrativa_asignada'],
          phone: prospecto['phone'],
        },
      })

      await sender.enviarTexto(msg.from, '¡Perfecto! Quedamos confirmados. Te escribimos antes para recordarte. ✅')
    } else {
      const bookingUrl = process.env['DEMO_BOOKING_URL']
      const followUp = bookingUrl
        ? `Puedes elegir el horario aquí: ${bookingUrl} ⏰`
        : '¿Cuándo tienes 20 minutos disponibles? Dime el día y la hora que mejor te quede.'
      await sender.enviarTexto(msg.from, followUp)
    }

    await saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: msg.from,
      turno: (prospecto['turns_total'] as number) + 1,
      tipo: 'meeting_confirmation',
      contenido: texto,
      action_taken: isMeetingConfirmed ? 'meeting_confirmed' : 'meeting_pending',
      langfuse_trace_id: traceId,
    }, client)

    await actualizarMensaje(mensajeId, { status: 'processed' })
    return true
  } catch (err) {
    console.error('[SDR] Error en handleMeetingConfirmation:', err)
    return false
  }
}

// REQ-hand-003: full founder notification format
function buildFounderNotification(
  prospecto: Record<string, unknown>,
  draftMessage: string,
  brief: Record<string, unknown> | null,
): string {
  const scoreTotal = (brief?.['qualification_score'] as number | undefined) ?? (prospecto['score_total'] as number)
  const segmento = String(brief?.['segmento_icp'] ?? prospecto['segmento_icp'] ?? 'desconocido')
  const narrativa = String(brief?.['narrativa_asignada'] ?? prospecto['narrativa_asignada'] ?? '?')
  const nombre = String(brief?.['nombre_contacto'] ?? prospecto['nombre'] ?? prospecto['phone'])
  const cargo = brief?.['cargo'] ? ` — ${String(brief['cargo'])}` : ''
  const empresa = brief?.['empresa'] ? String(brief['empresa']) : null
  const pais = brief?.['pais'] ? String(brief['pais']) : null
  const cultivo = brief?.['cultivo_principal'] ? String(brief['cultivo_principal']) : null
  const fincas = brief?.['fincas_en_cartera'] != null ? String(brief['fincas_en_cartera']) : '?'
  const sistemaActual = brief?.['sistema_actual'] ? String(brief['sistema_actual']) : 'desconocido'
  const eudrNivel = brief?.['eudr_urgency_nivel'] ? String(brief['eudr_urgency_nivel']) : 'desconocida'
  const scoresDim = brief?.['scores_por_dimension'] as Record<string, number> | null
  const presupuestoScore = scoresDim?.['presupuesto'] ?? (prospecto['score_presupuesto'] as number ?? 0)
  const dolor = brief?.['punto_de_dolor_principal'] ? String(brief['punto_de_dolor_principal']) : null
  const objeciones = (brief?.['objeciones_manejadas'] as string[] | null) ?? []
  const objecionesStr = objeciones.length > 0 ? objeciones.join(', ') : 'ninguna'

  const lines = [
    '⚡ LEAD CALIFICADO — Wasagro SDR',
    '',
    `Score: ${scoreTotal}/100 | ${segmento} | ${narrativa}`,
    '',
    `👤 ${nombre}${cargo}`,
  ]

  if (empresa) lines.push(`🏢 ${empresa}`)

  const ubicacion = [pais, cultivo].filter(Boolean).join(' | ')
  if (ubicacion) lines.push(`📍 ${ubicacion}`)

  lines.push(`🌾 ${fincas} fincas`)
  lines.push(`📋 Sistema actual: ${sistemaActual}`)
  lines.push(`🔥 EUDR: ${eudrNivel}`)
  lines.push(`💰 Presupuesto: ${presupuestoScore}/10`)
  lines.push('')
  if (dolor) lines.push(`Dolor principal: ${dolor}`)
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
