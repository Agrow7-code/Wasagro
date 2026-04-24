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

  let prospecto = await getSDRProspecto(msg.from, client) as Record<string, unknown> | null

  if (!prospecto) {
    const narrativa: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B'
    prospecto = await createSDRProspecto({ phone: msg.from, narrativa_asignada: narrativa }, client)
    trace.event({ name: 'sdr_prospecto_created', input: { phone: msg.from, narrativa } })
  }

  if (prospecto['status'] === 'qualified' && prospecto['founder_notified_at']) {
    await sender.enviarTexto(msg.from, 'Estamos revisando tu caso internamente. Te contactamos pronto. ✅')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
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

  const resultado = await llm.atenderSDR(entrada, traceId)

  // Regla 2: hard cap — never loop past MAX_SDR_TURNS turns
  if (resultado.action === 'continue_discovery' && entrada.turno >= MAX_SDR_TURNS) {
    resultado.action = 'graceful_exit'
    resultado.respuesta = 'Gracias por tu tiempo. Si en algún momento quieres retomar la conversación, aquí estaremos. ✅'
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
    nuevoStatus = 'qualified'
    dealBriefParaGuardar = {
      ...((resultado.deal_brief as object) ?? {}),
      draft_message: resultado.respuesta,
    }
    founderNotifiedAt = new Date().toISOString()

    const founderPhone = process.env['FOUNDER_PHONE']
    if (founderPhone) {
      const brief = resultado.deal_brief as Record<string, unknown> | null
      await sender.enviarTexto(founderPhone, buildFounderNotification(
        prospecto['phone'] as string,
        prospecto['nombre'] as string | null,
        resultado.respuesta,
        brief,
      ))
    }

    await sender.enviarTexto(msg.from, 'Voy a prepararte una propuesta específica para tu operación. En cuanto la tengamos lista, te la comparto. ✅')
    trace.event({ name: 'sdr_founder_notified', input: { prospecto_id: prospecto['id'], phone: prospecto['phone'] } })
  } else {
    await sender.enviarTexto(msg.from, resultado.respuesta)
  }

  const scoreAfter = SCORE_DIMS.reduce((sum, dim) => sum + nuevosDimensions[`score_${dim}`], 0)

  await updateSDRProspecto(prospecto['id'] as string, {
    ...nuevosDimensions,
    preguntas_realizadas: preguntasActualizadas,
    objeciones_manejadas: nuevasObjeciones,
    status: nuevoStatus,
    turns_total: nuevoTurno,
    deal_brief: dealBriefParaGuardar,
    founder_notified_at: founderNotifiedAt,
  }, client)

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

  await actualizarMensaje(mensajeId, { status: 'processed' })
}

export async function handleFounderApproval(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  client?: SupabaseClient,
): Promise<boolean> {
  const pendientes = await getSDRProspectosPendingApproval(client)
  if (pendientes.length === 0) return false

  const prospecto = pendientes[0]
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
}

function buildFounderNotification(
  prospectoPhone: string,
  nombre: string | null,
  draftMessage: string,
  brief: Record<string, unknown> | null,
): string {
  const lines = [
    '🎯 *Prospecto calificado*',
    `📱 ${nombre ?? prospectoPhone}`,
  ]
  if (brief) {
    if (brief['empresa']) lines.push(`🏢 ${String(brief['empresa'])}`)
    if (brief['segmento_icp']) lines.push(`👤 ${String(brief['segmento_icp'])}`)
    if (brief['qualification_score']) lines.push(`⭐ Score: ${String(brief['qualification_score'])}/100`)
    if (brief['punto_de_dolor_principal']) lines.push(`💡 Pain: ${String(brief['punto_de_dolor_principal'])}`)
  }
  lines.push(`\n*Draft propuesta:*\n${draftMessage}`)
  lines.push('\nResponde *SÍ* para enviar, *NO* para descartar, o escribe tu propio mensaje.')
  return lines.join('\n')
}
