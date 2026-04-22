import { langfuse } from '../integrations/langfuse.js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { EntradaEvento, EventoCampoExtraido } from '../types/dominio/EventoCampo.js'
import {
  getMensajeByWamid,
  registrarMensaje,
  actualizarMensaje,
  getUserByPhone,
  getFincaById,
  getLotesByFinca,
  getOrCreateSession,
  updateSession,
  saveEvento,
} from './supabaseQueries.js'
import { transcribirAudio } from './sttService.js'

let _sender: IWhatsAppSender | null = null
let _llm: IWasagroLLM | null = null

export function inicializarPipeline(sender: IWhatsAppSender, llm: IWasagroLLM): void {
  _sender = sender
  _llm = llm
}

export async function procesarMensajeEntrante(msg: NormalizedMessage, traceId: string): Promise<void> {
  if (!_sender || !_llm) throw new Error('Pipeline no inicializado — llamar inicializarPipeline primero')

  const trace = langfuse.trace({ id: traceId })

  // 1. Idempotency — wamid ya procesado
  const existing = await getMensajeByWamid(msg.wamid)
  if (existing) {
    trace.event({ name: 'mensaje_duplicado', level: 'WARNING', input: { wamid: msg.wamid } })
    return
  }

  // 2. Registrar mensaje (status: processing)
  const tipoMensaje = msg.tipo === 'texto' ? 'text' : msg.tipo === 'audio' ? 'audio' : 'image'
  const mensajeId = await registrarMensaje({
    wa_message_id: msg.wamid,
    phone: msg.from,
    tipo_mensaje: tipoMensaje,
    contenido_raw: msg.texto ?? null,
    media_ref: msg.mediaId ?? msg.audioUrl ?? null,
    langfuse_trace_id: traceId,
    status: 'processing',
  })

  try {
    // 3. Lookup usuario
    const usuario = await getUserByPhone(msg.from)

    if (!usuario) {
      await _sender.enviarTexto(msg.from, 'Hola, aún no estás registrado en Wasagro. Contacta a tu coordinador para activar tu cuenta. ✅')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      trace.event({ name: 'usuario_no_registrado', input: { phone: msg.from } })
      return
    }

    if (!usuario.onboarding_completo) {
      await handleOnboarding(msg, usuario, mensajeId, traceId)
      return
    }

    await handleEvento(msg, usuario, mensajeId, traceId)
  } catch (err) {
    console.error('[pipeline] Error procesando mensaje:', err)
    trace.event({ name: 'pipeline_error', level: 'ERROR', input: { error: String(err) } })
    await actualizarMensaje(mensajeId, { status: 'error', error_detail: String(err) }).catch(() => undefined)
    await _sender.enviarTexto(msg.from, 'Tuve un problema con tu mensaje. Intenta de nuevo en unos minutos. ⚠️').catch(() => undefined)
  }
}

async function handleOnboarding(
  msg: NormalizedMessage,
  _usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const session = await getOrCreateSession(msg.from, 'onboarding')
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''

  const contexto = {
    historial: (session.contexto_parcial['historial'] as Array<{ rol: 'usuario' | 'agente'; contenido: string }>) ?? [],
    preguntas_realizadas: session.clarification_count,
    datos_recolectados: (session.contexto_parcial['datos'] as Record<string, unknown>) ?? {},
  }

  const resultado = await _llm!.onboardar(texto, contexto, traceId)

  await updateSession(session.session_id, {
    clarification_count: resultado.onboarding_completo ? 0 : session.clarification_count + 1,
    contexto_parcial: {
      historial: [
        ...contexto.historial,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje },
      ],
      datos: { ...contexto.datos_recolectados, ...resultado.datos_finca },
    },
    status: resultado.onboarding_completo ? 'completed' : 'active',
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}

async function handleEvento(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  // Determinar transcripción
  let transcripcion: string

  if (msg.tipo === 'audio') {
    const audioRef = msg.audioUrl ?? msg.mediaId ?? ''
    transcripcion = await transcribirAudio(audioRef, traceId)
    await actualizarMensaje(mensajeId, { contenido_raw: transcripcion })
  } else if (msg.tipo === 'texto') {
    transcripcion = msg.texto!
  } else {
    // imagen u otro — guardar como observacion para revisión manual
    const eventoId = await saveEvento({
      finca_id: usuario.finca_id!,
      lote_id: null,
      tipo_evento: 'observacion',
      status: 'requires_review',
      datos_evento: { texto_libre: `Mensaje tipo ${msg.tipo}`, media_ref: msg.imagenUrl ?? msg.mediaId ?? null },
      descripcion_raw: `Mensaje tipo ${msg.tipo}`,
      confidence_score: 0,
      requiere_validacion: true,
      created_by: usuario.id,
      mensaje_id: mensajeId,
    })
    await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })
    await _sender!.enviarTexto(msg.from, 'Recibí tu imagen. La revisará tu asesor pronto. ✅')
    return
  }

  // Contexto de la finca para inyección en prompt
  const finca = usuario.finca_id ? await getFincaById(usuario.finca_id) : null
  const lotes = usuario.finca_id ? await getLotesByFinca(usuario.finca_id) : []
  const lista_lotes = lotes.length > 0
    ? lotes.map(l => `- ${l.lote_id}: "${l.nombre_coloquial}"${l.hectareas != null ? ` (${l.hectareas} ha)` : ''}`).join('\n')
    : 'No hay lotes registrados'

  // Sesión para tracking de clarificaciones (Regla 2)
  const session = await getOrCreateSession(msg.from, 'reporte')

  // Si hay clarificación en curso, combinar transcripción previa con la respuesta actual
  const transcripcionCombinada = session.clarification_count > 0 && session.contexto_parcial['original_transcripcion']
    ? `${String(session.contexto_parcial['original_transcripcion'])} ${transcripcion}`
    : transcripcion

  const entrada: EntradaEvento = {
    transcripcion: transcripcionCombinada,
    finca_id: usuario.finca_id ?? '',
    usuario_id: usuario.id,
    finca_nombre: finca?.nombre,
    cultivo_principal: finca?.cultivo_principal ?? undefined,
    pais: finca?.pais,
    lista_lotes,
  }

  const extracted = await _llm!.extraerEvento(entrada, traceId)

  if (extracted.requiere_clarificacion && session.clarification_count < 2) {
    // Regla 2: preguntar (máx 2 veces)
    await updateSession(session.session_id, {
      clarification_count: session.clarification_count + 1,
      contexto_parcial: { original_transcripcion: transcripcionCombinada },
    })
    const pregunta = extracted.pregunta_sugerida ?? '¿Puedes darme más detalles sobre lo que pasó?'
    await _sender!.enviarTexto(msg.from, pregunta)
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  // Persistir evento
  const tipo_evento = extracted.requiere_clarificacion ? 'nota_libre' : extracted.tipo_evento
  const status = extracted.requiere_clarificacion || extracted.confidence_score < 0.5 ? 'requires_review' : 'complete'

  const eventoId = await saveEvento({
    finca_id: usuario.finca_id!,
    lote_id: extracted.lote_id,
    tipo_evento,
    status,
    datos_evento: extracted.campos_extraidos,
    descripcion_raw: transcripcion,
    confidence_score: extracted.confidence_score,
    requiere_validacion: extracted.requiere_clarificacion,
    fecha_evento: extracted.fecha_evento,
    created_by: usuario.id,
    mensaje_id: mensajeId,
  })

  await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })
  await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
  await _sender!.enviarTexto(msg.from, buildConfirmacion(extracted, status))
}

function buildConfirmacion(extracted: EventoCampoExtraido, status: string): string {
  if (status === 'requires_review') {
    return 'Registré tu reporte. Lo revisará tu asesor. ✅'
  }
  const labels: Record<string, string> = {
    labor: 'labor', insumo: 'aplicación de insumo', plaga: 'plaga',
    clima: 'evento climático', cosecha: 'cosecha', gasto: 'gasto', observacion: 'observación',
  }
  const label = labels[extracted.tipo_evento] ?? extracted.tipo_evento
  const lote = extracted.lote_id ? ` en ${extracted.lote_id}` : ''
  return `✅ Registré tu ${label}${lote}. Seguimos.`
}
