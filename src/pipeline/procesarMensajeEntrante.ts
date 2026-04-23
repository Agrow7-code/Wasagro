import { langfuse } from '../integrations/langfuse.js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { EntradaEvento, EventoCampoExtraido } from '../types/dominio/EventoCampo.js'
import type { ContextoOnboardingAgricultor } from '../types/dominio/Onboarding.js'
import type { ContextoProspecto } from '../types/dominio/Prospecto.js'
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
  saveProspecto,
  getFincasDisponibles,
  updateUsuario,
} from './supabaseQueries.js'
import { transcribirAudio } from './sttService.js'

const ROLES_ADMIN = new Set(['propietario', 'jefe_finca', 'admin_org', 'director'])
const MAX_ONBOARDING_STEPS = 10
const MAX_PROSPECTO_STEPS = 6

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

  // 2. Registrar mensaje
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

    // Número desconocido → flujo de prospecto
    if (!usuario) {
      await handleProspecto(msg, mensajeId, traceId)
      return
    }

    // Onboarding incompleto → bifurcar por rol
    if (!usuario.onboarding_completo) {
      if (ROLES_ADMIN.has(usuario.rol)) {
        await handleOnboardingAdmin(msg, usuario, mensajeId, traceId)
      } else {
        await handleOnboardingAgricultor(msg, usuario, mensajeId, traceId)
      }
      return
    }

    await handleEvento(msg, usuario, mensajeId, traceId)
  } catch (err) {
    console.error('[pipeline] Error procesando mensaje:', err)
    trace.event({ name: 'pipeline_error', level: 'ERROR', input: { error: String(err) } })
    await actualizarMensaje(mensajeId, { status: 'error', error_detail: String(err) })
      .catch(e => console.error('[pipeline] Error actualizando estado de error:', e))
    await _sender.enviarTexto(msg.from, 'Tuve un problema con tu mensaje. Intenta de nuevo en un momento. ⚠️')
      .catch(e => console.error('[pipeline] Error enviando mensaje de error al usuario:', e))
  }
}

// ─── Flujo prospecto (número no registrado) ────────────────────────────────

async function handleProspecto(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const session = await getOrCreateSession(msg.from, 'reporte')
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : '[mensaje de voz o imagen]'

  const contexto: ContextoProspecto = {
    historial: (session.contexto_parcial['historial'] as Array<{ rol: 'usuario' | 'agente'; contenido: string }>) ?? [],
    paso_actual: session.clarification_count,
    datos_recopilados: (session.contexto_parcial['datos'] as Record<string, unknown>) ?? {},
  }

  const resultado = await _llm!.atenderProspecto(texto, contexto, traceId)

  // Guardar lead si es decision_maker con datos suficientes
  if (resultado.guardar_en_prospectos && resultado.tipo_contacto === 'decision_maker') {
    await saveProspecto({
      phone: msg.from,
      tipo_contacto: 'decision_maker',
      nombre: resultado.datos_extraidos.nombre,
      finca_nombre: resultado.datos_extraidos.finca_nombre,
      cultivo_principal: resultado.datos_extraidos.cultivo_principal,
      pais: resultado.datos_extraidos.pais,
      tamanio_aproximado: resultado.datos_extraidos.tamanio_aproximado,
      interes_demo: resultado.datos_extraidos.interes_demo,
    }).catch(err => console.error('[pipeline] Error guardando prospecto:', err))
  }

  await updateSession(session.session_id, {
    clarification_count: Math.min(resultado.siguiente_paso, MAX_PROSPECTO_STEPS),
    contexto_parcial: {
      historial: [
        ...contexto.historial,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje_para_usuario },
      ],
      datos: { ...contexto.datos_recopilados, ...resultado.datos_extraidos },
    },
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}

// ─── Onboarding admin / propietario ───────────────────────────────────────

async function handleOnboardingAdmin(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
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

  const resultado = await _llm!.onboardarAdmin(texto, contexto, traceId)

  // Cuando completa: actualizar usuario en DB
  if (resultado.onboarding_completo) {
    await updateUsuario(usuario.id, { onboarding_completo: true }).catch(err => {
      console.error('[pipeline] Error actualizando usuario onboarding:', err)
      langfuse.trace({ id: traceId }).event({ name: 'update_usuario_error', level: 'ERROR', input: { error: String(err) } })
    })
  }

  const nextStep = session.clarification_count + 1
  if (!resultado.onboarding_completo && nextStep >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_admin_max_steps', level: 'WARNING', input: { steps: nextStep } })
  }

  await updateSession(session.session_id, {
    clarification_count: resultado.onboarding_completo ? 0 : Math.min(nextStep, MAX_ONBOARDING_STEPS),
    contexto_parcial: {
      historial: [
        ...contexto.historial,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje_para_usuario },
      ],
      datos: {
        ...contexto.datos_recolectados,
        ...(resultado.datos_extraidos ?? {}),
      },
    },
    status: resultado.onboarding_completo || nextStep >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}

// ─── Onboarding agricultor / técnico ──────────────────────────────────────

async function handleOnboardingAgricultor(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const session = await getOrCreateSession(msg.from, 'onboarding')
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''

  const historialPrevio = (session.contexto_parcial['historial'] as Array<{ rol: 'usuario' | 'agente'; contenido: string }>) ?? []
  const datosPrevios = (session.contexto_parcial['datos'] as Record<string, unknown>) ?? {}

  // Construir lista de fincas disponibles para inyectar en el prompt
  const fincas = await getFincasDisponibles()
  const fincasDisponibles = fincas.length > 0
    ? fincas.map(f => `- ${f.finca_id}: ${f.nombre} (${f.cultivo_principal ?? 'cultivo no especificado'})`).join('\n')
    : 'No hay fincas registradas aún'

  const contexto: ContextoOnboardingAgricultor = {
    historial: historialPrevio,
    paso_actual: session.clarification_count,
    datos_recolectados: datosPrevios,
    fincas_disponibles: fincasDisponibles,
  }

  const resultado = await _llm!.onboardarAgricultor(texto, contexto, traceId)

  // Si el agricultor quedó pendiente de aprobación → loggear para notificación al jefe
  if (resultado.status_usuario === 'pendiente_aprobacion') {
    langfuse.trace({ id: traceId }).event({
      name: 'agricultor_pendiente_aprobacion',
      input: {
        usuario_id: usuario.id,
        phone: msg.from,
        finca_id: resultado.datos_extraidos?.finca_id,
      },
    })
    // TODO: enviar WhatsApp al jefe de la finca cuando haya query getJefeByFinca
  }

  if (resultado.onboarding_completo) {
    await updateUsuario(usuario.id, { onboarding_completo: true }).catch(err => {
      console.error('[pipeline] Error actualizando agricultor onboarding:', err)
      langfuse.trace({ id: traceId }).event({ name: 'update_usuario_error', level: 'ERROR', input: { error: String(err) } })
    })
  }

  const nextStepAgr = session.clarification_count + 1
  if (!resultado.onboarding_completo && nextStepAgr >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_agricultor_max_steps', level: 'WARNING', input: { steps: nextStepAgr } })
  }

  await updateSession(session.session_id, {
    clarification_count: resultado.onboarding_completo ? 0 : Math.min(nextStepAgr, MAX_ONBOARDING_STEPS),
    contexto_parcial: {
      historial: [
        ...historialPrevio,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje_para_usuario },
      ],
      datos: { ...datosPrevios, ...(resultado.datos_extraidos ?? {}) },
    },
    status: resultado.onboarding_completo || nextStepAgr >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}

// ─── Flujo de reporte de campo ─────────────────────────────────────────────

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
    try {
      transcripcion = await transcribirAudio(audioRef, traceId)
    } catch (err) {
      if (err instanceof Error && err.message === 'STT_NO_DISPONIBLE') {
        langfuse.trace({ id: traceId }).event({
          name: 'stt_no_disponible',
          level: 'WARNING',
          input: { audio_ref: audioRef, wamid: msg.wamid },
        })
        await _sender!.enviarTexto(msg.from, 'Por ahora no proceso audios. Escríbeme el mensaje en texto. ✅')
        await actualizarMensaje(mensajeId, { status: 'processed' })
        return
      }
      throw err
    }
    await actualizarMensaje(mensajeId, { contenido_raw: transcripcion })
  } else if (msg.tipo === 'texto') {
    transcripcion = msg.texto!
  } else {
    // imagen — guardar como observacion para revisión
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
    await _sender!.enviarTexto(msg.from, 'Recibí tu imagen. La revisa tu asesor pronto. ✅')
    return
  }

  // Contexto de la finca
  const finca = usuario.finca_id ? await getFincaById(usuario.finca_id) : null
  const lotes = usuario.finca_id ? await getLotesByFinca(usuario.finca_id) : []
  const lista_lotes = lotes.length > 0
    ? lotes.map(l => `- ${l.lote_id}: "${l.nombre_coloquial}"${l.hectareas != null ? ` (${l.hectareas} ha)` : ''}`).join('\n')
    : 'No hay lotes registrados'

  const session = await getOrCreateSession(msg.from, 'reporte')

  // ── Confirmación pendiente: el usuario responde al resumen ────────────────
  if (session.status === 'pending_confirmation') {
    const respuesta = transcripcion.toLowerCase().trim()
    const confirma = /^(sí|si|s|yes|ok|correcto|exacto|dale|listo|confirmo|✅)/.test(respuesta)

    if (confirma) {
      const stored = session.contexto_parcial as { extracted_data: EventoCampoExtraido; transcripcion_original: string }
      const ext = stored.extracted_data
      const descRaw = stored.transcripcion_original ?? transcripcion
      const tipo_evento = ext.requiere_clarificacion ? 'nota_libre' : ext.tipo_evento
      const evStatus = (ext.confidence_score < 0.5 || ext.requiere_clarificacion) ? 'requires_review' : 'complete'

      if (ext.alerta_urgente) {
        langfuse.trace({ id: traceId }).event({
          name: 'alerta_plaga_urgente',
          level: 'WARNING',
          input: { finca_id: usuario.finca_id, campos: ext.campos_extraidos },
        })
      }

      const eventoId = await saveEvento({
        finca_id: usuario.finca_id!,
        lote_id: ext.lote_id,
        tipo_evento,
        status: evStatus,
        datos_evento: {
          ...ext.campos_extraidos,
          ...(ext.lote_detectado_raw ? { lote_detectado_raw: ext.lote_detectado_raw } : {}),
        },
        descripcion_raw: descRaw,
        confidence_score: ext.confidence_score,
        requiere_validacion: ext.requiere_validacion || ext.confidence_score < 0.5,
        fecha_evento: ext.fecha_evento,
        created_by: usuario.id,
        mensaje_id: mensajeId,
      })

      await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })
      await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
      const loteName = ext.lote_id
        ? (lotes.find(l => l.lote_id === ext.lote_id)?.nombre_coloquial ?? undefined)
        : undefined
      await _sender!.enviarTexto(msg.from, buildConfirmacion(ext, evStatus, loteName))
      return
    }

    // El usuario quiere corregir → mergear corrección con lo ya extraído y re-extraer
    const stored = session.contexto_parcial as { extracted_data?: EventoCampoExtraido; transcripcion_original?: string }
    const transcripcionMerged = stored.transcripcion_original
      ? `${stored.transcripcion_original}. Corrección: ${transcripcion}`
      : transcripcion

    const entradaCorreccion: EntradaEvento = {
      transcripcion: transcripcionMerged,
      finca_id: usuario.finca_id ?? '',
      usuario_id: usuario.id,
      nombre_usuario: usuario.nombre ?? undefined,
      finca_nombre: finca?.nombre,
      cultivo_principal: finca?.cultivo_principal ?? undefined,
      pais: finca?.pais,
      lista_lotes,
    }

    const extractedCorreccion = await _llm!.extraerEvento(entradaCorreccion, traceId)

    if (extractedCorreccion.tipo_evento !== 'sin_evento') {
      await updateSession(session.session_id, {
        status: 'pending_confirmation',
        clarification_count: 0,
        contexto_parcial: {
          extracted_data: extractedCorreccion as unknown as Record<string, unknown>,
          transcripcion_original: transcripcionMerged,
        },
      })
      await _sender!.enviarTexto(msg.from, buildResumenParaConfirmar(extractedCorreccion, lotes))
      await actualizarMensaje(mensajeId, { status: 'processing' })
      return
    }

    // Corrección resultó en sin_evento → reset limpio
    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    await _sender!.enviarTexto(msg.from, '¿Qué quieres registrar?')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  // ── Extracción ────────────────────────────────────────────────────────────
  const transcripcionCombinada = session.clarification_count > 0 && session.contexto_parcial['original_transcripcion']
    ? `${String(session.contexto_parcial['original_transcripcion'])} ${transcripcion}`
    : transcripcion

  const entrada: EntradaEvento = {
    transcripcion: transcripcionCombinada,
    finca_id: usuario.finca_id ?? '',
    usuario_id: usuario.id,
    nombre_usuario: usuario.nombre ?? undefined,
    finca_nombre: finca?.nombre,
    cultivo_principal: finca?.cultivo_principal ?? undefined,
    pais: finca?.pais,
    lista_lotes,
  }

  const extracted = await _llm!.extraerEvento(entrada, traceId)

  // Mensajes que no son eventos de campo (saludo, consulta)
  if (extracted.tipo_evento === 'sin_evento') {
    const respuesta = extracted.pregunta_sugerida ?? '¿En qué te puedo ayudar?'
    await _sender!.enviarTexto(msg.from, respuesta)
    await actualizarMensaje(mensajeId, { status: 'processed' })
    await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
    return
  }

  // Lote mencionado pero no existe en la finca → pedir corrección con lista
  if (extracted.lote_detectado_raw && !extracted.lote_id && lotes.length > 0 && session.clarification_count < 2) {
    const listaLotes = lotes.map(l => `• ${l.nombre_coloquial} (${l.lote_id})`).join('\n')
    await updateSession(session.session_id, {
      clarification_count: session.clarification_count + 1,
      contexto_parcial: { original_transcripcion: transcripcionCombinada },
    })
    await _sender!.enviarTexto(
      msg.from,
      `El lote "${extracted.lote_detectado_raw}" no está registrado en tu finca. Los lotes disponibles son:\n${listaLotes}\n\n¿En cuál fue?`
    )
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  // Clarificación pendiente (Regla 2: máx 2 preguntas)
  if (extracted.requiere_clarificacion && session.clarification_count < 2) {
    await updateSession(session.session_id, {
      clarification_count: session.clarification_count + 1,
      contexto_parcial: { original_transcripcion: transcripcionCombinada },
    })
    const pregunta = extracted.pregunta_sugerida ?? '¿Puedes contarme más sobre lo que pasó?'
    await _sender!.enviarTexto(msg.from, pregunta)
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  // ── Mostrar resumen y esperar confirmación antes de guardar ───────────────
  await updateSession(session.session_id, {
    status: 'pending_confirmation',
    contexto_parcial: {
      extracted_data: extracted as unknown as Record<string, unknown>,
      transcripcion_original: transcripcion,
    },
  })
  await _sender!.enviarTexto(msg.from, buildResumenParaConfirmar(extracted, lotes))
  await actualizarMensaje(mensajeId, { status: 'processing' })
}

function buildResumenParaConfirmar(
  extracted: EventoCampoExtraido,
  lotes: Array<{ lote_id: string; nombre_coloquial: string }>,
): string {
  const etiquetas: Record<string, string> = {
    labor: '🌾 Labor de campo',
    insumo: '🧪 Aplicación de insumo',
    plaga: '🐛 Plaga reportada',
    clima: '🌧️ Evento climático',
    cosecha: '📦 Cosecha',
    gasto: '💰 Gasto',
    infraestructura: '🔧 Infraestructura',
    observacion: '📝 Observación',
    nota_libre: '📝 Nota',
  }

  const tipo = etiquetas[extracted.tipo_evento] ?? '📋 Reporte'
  const loteNombre = extracted.lote_id
    ? (lotes.find(l => l.lote_id === extracted.lote_id)?.nombre_coloquial ?? null)
    : null
  const loteLinea = loteNombre ? `• Lote: ${loteNombre}\n` : ''
  const fechaLinea = extracted.fecha_evento ? `• Fecha: ${extracted.fecha_evento}\n` : ''

  const SKIP = new Set(['lote_detectado_raw'])
  const lineas: string[] = []
  for (const [k, v] of Object.entries(extracted.campos_extraidos)) {
    if (SKIP.has(k) || v === null || v === undefined) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 !== null && v2 !== undefined) lineas.push(`• ${k2}: ${v2}`)
      }
    } else {
      lineas.push(`• ${k}: ${v}`)
    }
  }

  return `Esto es lo que entendí:\n\n${tipo}\n${loteLinea}${fechaLinea}${lineas.join('\n')}\n\nResponde *sí* para guardar o corrígeme si algo está mal.`
}

function buildConfirmacion(extracted: EventoCampoExtraido, status: string, loteName?: string): string {
  if (status === 'requires_review') {
    return 'Registré tu reporte. Lo revisa tu asesor pronto. ✅'
  }
  const labels: Record<string, string> = {
    labor: 'labor de campo',
    insumo: 'aplicación',
    plaga: 'reporte de plaga',
    clima: 'evento climático',
    cosecha: 'cosecha',
    gasto: 'gasto',
    infraestructura: 'reporte de infraestructura',
    observacion: 'observación',
    nota_libre: 'nota',
  }
  const label = labels[extracted.tipo_evento] ?? 'reporte'
  const lote = loteName ? ` en ${loteName}` : ''
  const alerta = extracted.alerta_urgente ? ' ⚠️ Tu asesor revisará este caso pronto.' : ''
  return `✅ Registré tu ${label}${lote}.${alerta}`
}
