import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { EntradaEvento, EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { IEmbeddingService } from '../../integrations/llm/EmbeddingService.js'
import { guardarEmbeddingEnEvento } from '../supabaseQueries.js'
import {
  getUserByPhone,
  getFincaById,
  getLotesByFinca,
  getOrCreateSession,
  updateSession,
  saveEvento,
  updateFincaCoordenadas,
  actualizarMensaje,
  getPendingAgricultoresByFinca,
  approveAgricultor
} from '../supabaseQueries.js'
import { transcribirAudio } from '../sttService.js'
import { handleDocumento, procesarFilasExcelConfirmadas } from '../procesarExcel.js'
import { _sender, _llm, _intentDetector, _ragRetriever, _embeddingService, ROLES_ADMIN } from '../procesarMensajeEntrante.js'

// ─── Flujo de reporte de campo ─────────────────────────────────────────────

export async function handleEvento(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  // Approval command: "aprobar [nombre]" from jefe/propietario (text only, before audio processing)
  if (msg.tipo === 'texto' && ROLES_ADMIN.has(usuario.rol) && usuario.finca_id) {
    const approvalMatch = (msg.texto ?? '').toLowerCase().match(/^aprobar\s+(.+)/)
    if (approvalMatch) {
      await handleAprobacion(msg, usuario, mensajeId, traceId, approvalMatch[1]?.trim() ?? '')
      return
    }
  }

  // Ubicación — solicitar confirmación antes de persistir coordenadas (P7)
  if (msg.tipo === 'ubicacion') {
    if (!usuario.finca_id) {
      await _sender!.enviarTexto(msg.from, 'Para guardar tu ubicación primero necesitas registrar tu finca. ⚠️')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }
    const session = await getOrCreateSession(msg.from, 'reporte')
    await updateSession(session.session_id, {
      status: 'pending_location_confirm',
      contexto_parcial: { lat: msg.latitud, lng: msg.longitud },
    })
    await _sender!.enviarTexto(
      msg.from,
      `Voy a guardar la ubicación de tu finca (${msg.latitud?.toFixed(5)}, ${msg.longitud?.toFixed(5)}). ¿Confirmas? Responde *sí* o *no*. ✅`,
    )
    await actualizarMensaje(mensajeId, { status: 'awaiting_confirmation' })
    return
  }

  // Documento (XLSX / CSV) — clasificar y pedir confirmación
  if (msg.tipo === 'documento') {
    const finca = usuario.finca_id ? await getFincaById(usuario.finca_id) : null
    const docUsuario: { id: string; finca_id: string | null; finca_nombre?: string; cultivo_principal?: string } = { id: usuario.id, finca_id: usuario.finca_id }
    if (finca?.nombre !== undefined) docUsuario.finca_nombre = finca.nombre
    if (finca?.cultivo_principal != null) docUsuario.cultivo_principal = finca.cultivo_principal
    await handleDocumento(
      msg,
      docUsuario,
      mensajeId,
      traceId,
      _sender!,
      _llm!,
    )
    return
  }

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
      langfuse.trace({ id: traceId }).event({
        name: 'stt_error',
        level: 'ERROR',
        input: { audio_ref: audioRef, wamid: msg.wamid, error: String(err) },
      })
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

  // ── Confirmación pendiente de ubicación ──────────────────────────────────
  if (session.status === 'pending_location_confirm') {
    const respuesta = transcripcion.toLowerCase().trim()
    const confirma = /^(sí|si|s|yes|ok|dale|confirmo|✅)/.test(respuesta)

    if (confirma) {
      const lat = session.contexto_parcial['lat'] as number
      const lng = session.contexto_parcial['lng'] as number
      await updateFincaCoordenadas(usuario.finca_id!, lat, lng)
      langfuse.trace({ id: traceId }).event({
        name: 'finca_coordenadas_actualizadas',
        input: { finca_id: usuario.finca_id, lat, lng },
      })
      await _sender!.enviarTexto(msg.from, 'Guardé la ubicación de tu finca. ✅ Con esto puedo avisarte del clima y más. Cuando quieras, cuéntame lo que pasó en el campo.')
    } else {
      await _sender!.enviarTexto(msg.from, 'Listo, no guardé la ubicación. Cuando quieras, cuéntame lo que pasó en el campo.')
    }

    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  // ── Confirmación pendiente de Excel ──────────────────────────────────────
  if (session.status === 'pending_excel_confirm') {
    const respuesta = transcripcion.toLowerCase().trim()
    const confirma = /^(sí|si|s|yes|ok|dale|listo|confirmo|✅|procesa|procésalo|adelante)/.test(respuesta)

    if (!confirma) {
      await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
      await _sender!.enviarTexto(msg.from, 'Listo, cancelé el procesamiento del archivo. Cuando quieras, cuéntame lo que pasó en la finca.')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }

    const { insertados, errores } = await procesarFilasExcelConfirmadas(
      session.contexto_parcial,
      usuario.id,
      usuario.finca_id!,
      traceId,
    )

    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    const msj = errores > 0
      ? `Procesé ${insertados} registros de tu archivo. ${errores} filas tuvieron errores y quedaron pendientes de revisión. ✅`
      : `Procesé ${insertados} registros de tu archivo. Todos quedaron guardados para revisión. ✅`
    await _sender!.enviarTexto(msg.from, msj)
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

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
          ...(ext.lote_detectado_raw != null ? { lote_detectado_raw: ext.lote_detectado_raw } : {}),
          _meta: {
            confidence_por_campo: ext.confidence_por_campo,
            campos_faltantes: ext.campos_faltantes,
          },
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

      // Guardar embedding async — no bloqueamos la respuesta al usuario
      if (_embeddingService && eventoId) {
        guardarEmbeddingEvento(eventoId, descRaw, _embeddingService).catch((err: unknown) => {
          console.error('[embedding] Error guardando embedding:', err)
          langfuse.trace({ id: traceId }).event({
            name: 'embedding_error',
            level: 'ERROR',
            output: { error: String(err), evento_id: eventoId },
          })
        })
      }

      const loteName = ext.lote_id
        ? (lotes.find(l => l.lote_id === ext.lote_id)?.nombre_coloquial ?? undefined)
        : undefined
      await _sender!.enviarTexto(msg.from, buildConfirmacion(ext, evStatus, loteName))
      return
    }

    // El usuario quiere corregir → detectar intención y re-extraer con tipo_forzado si aplica
    const stored = session.contexto_parcial as { extracted_data?: EventoCampoExtraido; transcripcion_original?: string }
    const transcripcionMerged = stored.transcripcion_original
      ? `Corrección del agricultor: ${transcripcion}. Contexto previo (puede estar incorrecto): ${stored.transcripcion_original}`
      : transcripcion

    const tipoPrevio = (stored.extracted_data?.tipo_evento ?? 'nota_libre') as Parameters<NonNullable<typeof _intentDetector>['detectar']>[0]['tipo_previo']
    const intencion = _intentDetector
      ? await _intentDetector.detectar(
          { mensaje_usuario: transcripcion, tipo_previo: tipoPrevio, transcripcion_previa: stored.transcripcion_original ?? '' },
          traceId,
        )
      : { tipo: 'nuevo_evento' as const, confianza: 0 }

    const entradaCorreccion: EntradaEvento = {
      transcripcion: transcripcionMerged,
      finca_id: usuario.finca_id ?? '',
      usuario_id: usuario.id,
      nombre_usuario: usuario.nombre ?? undefined,
      finca_nombre: finca?.nombre,
      cultivo_principal: finca?.cultivo_principal ?? undefined,
      pais: finca?.pais,
      lista_lotes,
      ...(intencion.tipo === 'correccion_tipo' && intencion.tipo_forzado
        ? { tipo_forzado: intencion.tipo_forzado }
        : {}),
    }

    const extractedCorreccion = await _llm!.extraerEvento(entradaCorreccion, traceId)

    if (extractedCorreccion.tipo_evento !== 'sin_evento') {
      // Validar lote también en el path de corrección
      if (extractedCorreccion.lote_detectado_raw && !extractedCorreccion.lote_id && lotes.length > 0) {
        const listaLotes = lotes.map(l => `• ${l.nombre_coloquial}`).join('\n')
        await updateSession(session.session_id, {
          status: 'active',
          clarification_count: 1,
          contexto_parcial: { original_transcripcion: transcripcionMerged },
        })
        await _sender!.enviarTexto(
          msg.from,
          `El lote "${extractedCorreccion.lote_detectado_raw}" no está registrado en tu finca. Los lotes disponibles son:\n${listaLotes}\n\n¿En cuál fue?`
        )
        await actualizarMensaje(mensajeId, { status: 'processing' })
        return
      }

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

  const contexto_rag = usuario.finca_id && _ragRetriever
    ? await _ragRetriever.recuperarContexto(usuario.finca_id, transcripcionCombinada)
    : undefined

  const entrada: EntradaEvento = {
    transcripcion: transcripcionCombinada,
    finca_id: usuario.finca_id ?? '',
    usuario_id: usuario.id,
    nombre_usuario: usuario.nombre ?? undefined,
    finca_nombre: finca?.nombre,
    cultivo_principal: finca?.cultivo_principal ?? undefined,
    pais: finca?.pais,
    lista_lotes,
    ...(contexto_rag ? { contexto_rag } : {}),
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
    const listaLotes = lotes.map(l => `• ${l.nombre_coloquial}`).join('\n')
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

async function handleAprobacion(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
  nombreBuscado: string,
): Promise<void> {
  const pendientes = await getPendingAgricultoresByFinca(usuario.finca_id!)
  const target = pendientes.find(p => (p.nombre ?? '').toLowerCase().includes(nombreBuscado.toLowerCase()))

  if (!target) {
    await _sender!.enviarTexto(msg.from, `No encontré a nadie pendiente con ese nombre ⚠️`)
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  await approveAgricultor(target.id)

  langfuse.trace({ id: traceId }).event({
    name: 'agricultor_aprobado',
    level: 'DEFAULT',
    input: { aprobado_id: target.id, aprobado_phone: target.phone, jefe_id: usuario.id },
  })

  await _sender!.enviarTexto(msg.from, `✅ ${target.nombre ?? target.phone} ya está activo en la finca.`)
  await _sender!.enviarTexto(target.phone, `✅ Ya te activaron. Puedes mandar tus reportes de campo.`)
  await actualizarMensaje(mensajeId, { status: 'processed' })
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

async function guardarEmbeddingEvento(
  eventoId: string,
  descripcion_raw: string,
  svc: IEmbeddingService,
): Promise<void> {
  const embedding = await svc.generarEmbedding(descripcion_raw)
  await guardarEmbeddingEnEvento(eventoId, `[${embedding.join(',')}]`)
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

