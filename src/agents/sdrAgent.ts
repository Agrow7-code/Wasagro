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

    const objection_detected = detectarObjecion(texto)
    const nuevoTurno = (prospecto['turns_total'] as number) + 1
    const preHandoffTrigger = detectarHandoffTrigger(texto, nuevoTurno)

    // Contexto para el LLM Extractor
    const contextoActual = `
Fincas/Hectáreas: ${prospecto['fincas_en_cartera'] ?? 'Desconocido'}
Cultivo Principal: ${prospecto['cultivo_principal'] ?? 'Desconocido'}
País: ${prospecto['pais'] ?? 'Desconocido'}
Sistema Actual: ${prospecto['sistema_actual'] ?? 'Desconocido'}
    `.trim()

    // 1. LLM extrae datos deterministas
    const extraccion = await llm.extraerDatosSDR(texto, contextoActual, traceId)

    // 2. Actualizar estado del prospecto
    const updateData: Record<string, unknown> = {}
    if (extraccion.fincas_en_cartera != null && prospecto['fincas_en_cartera'] == null) updateData.fincas_en_cartera = extraccion.fincas_en_cartera
    if (extraccion.cultivo_principal != null && prospecto['cultivo_principal'] == null) updateData.cultivo_principal = extraccion.cultivo_principal
    if (extraccion.pais != null && prospecto['pais'] == null) updateData.pais = extraccion.pais
    if (extraccion.sistema_actual != null && prospecto['sistema_actual'] == null) updateData.sistema_actual = extraccion.sistema_actual

    const combinedProspecto = { ...prospecto, ...updateData }

    const objecionesActuales = (prospecto['objeciones_manejadas'] as string[]) ?? []
    const nuevasObjeciones = objection_detected && !objecionesActuales.includes(objection_detected)
      ? [...objecionesActuales, objection_detected]
      : objecionesActuales
    if (nuevasObjeciones.length > objecionesActuales.length) updateData.objeciones_manejadas = nuevasObjeciones

    let nuevoStatus = prospecto['status'] === 'new' ? 'en_discovery' : (prospecto['status'] as string)
    updateData.turns_total = nuevoTurno
    
    // 3. Enrutamiento Lógico (TypeScript + LLM Writer)
    let respuesta = ''
    let action = 'continue_discovery'
    let requires_founder_approval = false

    if (extraccion.es_spam) {
      action = 'graceful_exit'
      respuesta = 'Soy el asistente de Wasagro, un sistema para operaciones agrícolas. Creo que te has equivocado de número o consulta. ¡Que tengas un buen día! 👋'
    } else if (extraccion.pregunta_precio || preHandoffTrigger === 'price_readiness') {
      action = 'request_pricing'
      respuesta = calcularPrecio(combinedProspecto['segmento_icp'] as string, (combinedProspecto['fincas_en_cartera'] as number) || 0)
      trace.event({ name: 'sdr_price_requested', input: { segmento_icp: combinedProspecto['segmento_icp'], respuesta } })
    } else if (preHandoffTrigger === 'human_request') {
      action = 'propose_pilot'
      requires_founder_approval = true
      respuesta = 'Con gusto. Agendemos una breve videollamada con nuestro equipo para que te explique a detalle y resolvamos tus dudas.'
    } else {
      // Contar cuántos datos tenemos
      let datosConocidos = 0
      if (combinedProspecto['fincas_en_cartera'] != null) datosConocidos++
      if (combinedProspecto['cultivo_principal'] != null) datosConocidos++
      if (combinedProspecto['pais'] != null) datosConocidos++
      if (combinedProspecto['sistema_actual'] != null) datosConocidos++

      let directiva = ''

      if (datosConocidos >= 3 || nuevoTurno >= MAX_SDR_TURNS) {
        action = 'propose_pilot'
        requires_founder_approval = true
        directiva = 'El prospecto ya está calificado. Usa la información que tenemos (ej. si usa Excel, si tiene X hectáreas de Y cultivo) para redactar un argumento persuasivo de 3 o 4 oraciones. Explícale exactamente cómo Wasagro le va a resolver la vida eliminando el papel/Excel mediante registros por audios de WhatsApp. Termina el mensaje proponiendo agendar una breve videollamada de 15 minutos para mostrarle cómo se adapta a su finca específica.'
      } else {
        if (nuevoTurno === 1) {
          directiva = 'Saluda diciendo literalmente: "Hola, bienvenido a Wasagro. Soy el asistente digital de Wasagro y estoy aquí para ayudarte a simplificar la captura de datos en tu finca. Para empezar, ¿podrías contarme qué tipo de operación agrícola tienes y cuántas hectáreas o fincas gestionas?" (Si la fuente o el mensaje incluye contexto de un anuncio, puedes adaptarlo, pero esa es la intención).'
        } else if (combinedProspecto['fincas_en_cartera'] == null) {
          directiva = 'Haz una pregunta corta sobre cuántas hectáreas o fincas administran actualmente.'
        } else if (combinedProspecto['cultivo_principal'] == null) {
          directiva = 'Haz una pregunta corta sobre qué tipo de cultivo principal tienen en la finca.'
        } else if (combinedProspecto['pais'] == null) {
          directiva = 'Haz una pregunta corta para saber en qué país está ubicada su operación agrícola.'
        } else if (combinedProspecto['sistema_actual'] == null) {
          directiva = 'Haz una pregunta corta sobre cómo registran actualmente las labores o aplicaciones de insumos (ej. papel, Excel).'
        } else {
          action = 'propose_pilot'
          requires_founder_approval = true
          directiva = 'Propón agendar una breve videollamada para mostrarles cómo Wasagro les ayuda a registrar todo desde WhatsApp.'
        }
      }

      respuesta = await llm.redactarMensajeSDR(texto, contextoActual, directiva, traceId)
    }

    // 4. Ejecución de Acción
    if (action === 'graceful_exit') {
      nuevoStatus = 'unqualified'
      updateData.status = nuevoStatus
      await sender.enviarTexto(msg.from, respuesta)
      trace.event({ name: 'sdr_unqualified', input: { exit_reason: 'spam_detected' } })
    } else if (action === 'propose_pilot' || requires_founder_approval) {
      nuevoStatus = 'piloto_propuesto'
      updateData.status = nuevoStatus
      updateData.founder_notified_at = new Date().toISOString()
      
      const brief = {
        draft_message: respuesta,
        fincas_en_cartera: combinedProspecto['fincas_en_cartera'],
        cultivo_principal: combinedProspecto['cultivo_principal'],
        pais: combinedProspecto['pais'],
        sistema_actual: combinedProspecto['sistema_actual'],
        handoff_trigger: preHandoffTrigger ?? 'score_threshold',
        source_context: combinedProspecto['source_context'],
        segmento_icp: combinedProspecto['segmento_icp']
      }
      updateData.deal_brief = brief

      await sender.enviarTexto(msg.from, respuesta)
      const bookingUrl = process.env['DEMO_BOOKING_URL']
      const followUp = bookingUrl
        ? `📅 Puedes elegir el horario aquí: ${bookingUrl}`
        : '¿Qué día y hora te queda mejor la próxima semana? 📅'
      await sender.enviarTexto(msg.from, followUp)

      const founderEmail = process.env['FOUNDER_EMAIL']
      if (founderEmail) {
        try {
          const { Resend } = await import('resend')
          const resendClient = new Resend(process.env['RESEND_API_KEY'])
          await resendClient.emails.send({
            from: 'SDR Agent <sdr@wasagro.com>',
            to: founderEmail,
            subject: `⚡ LEAD CALIFICADO: ${combinedProspecto['segmento_icp']} - ${combinedProspecto['pais'] ?? 'País Desconocido'}`,
            text: buildFounderNotification(combinedProspecto, respuesta, brief),
          })
          console.log(`[SDR] Deal Brief enviado por correo a ${founderEmail}`)
        } catch (emailErr) {
          console.error('[SDR] Error enviando Handoff por email:', emailErr)
        }
      }
      trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: prospecto['id'] } })
      trace.event({ name: 'sdr_qualified', input: { turns_to_qualify: nuevoTurno } })
    } else {
      updateData.status = nuevoStatus
      await sender.enviarTexto(msg.from, respuesta)
    }

    // 5. Persistencia
    await updateSDRProspecto(prospecto['id'] as string, updateData, client)

    await saveSDRInteraccion({
      prospecto_id: prospecto['id'],
      phone: msg.from,
      turno: nuevoTurno,
      tipo: 'inbound',
      contenido: texto,
      score_before: 0,
      score_after: 0,
      score_delta: { eudr_urgency: 0, tamano_cartera: 0, calidad_dato: 0, champion: 0, timeline_decision: 0, presupuesto: 0 },
      objection_detected,
      action_taken: action,
      narrativa: prospecto['narrativa_asignada'],
      segmento_icp: prospecto['segmento_icp'],
      langfuse_trace_id: traceId,
    }, client)

    // Task 11: Enqueue sdr_chaser job (20h delay)
    try {
      const { getBoss, isPgBossReady } = await import('../workers/pgBoss.js')
      if (isPgBossReady()) {
        const boss = getBoss()
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