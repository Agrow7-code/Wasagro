import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { EntradaEvento, EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { IEmbeddingService } from '../../integrations/llm/EmbeddingService.js'
import { guardarEmbeddingEnEvento } from '../supabaseQueries.js'
import { enriquecerDatosEventoInfraestructura } from '../derivadorInfraestructura.js'
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
  } else if (msg.tipo === 'imagen') {
    const imageUrl = msg.imagenUrl ?? msg.mediaId
    if (!imageUrl) {
      await _sender!.enviarTexto(msg.from, 'No pude procesar la imagen enviada. ⚠️')
      return
    }
    
    await _sender!.enviarTexto(msg.from, 'Analizando tu imagen con la base de datos agronómica... 🔍')

    try {
      // 1. Visión Cruda (Objective Description)
      const descripcionVisual = await _llm!.describirImagenVisual(imageUrl, traceId)
      
      // 2. RAG Context Retrieval
      const contextoRag = usuario.finca_id && _ragRetriever 
        ? await _ragRetriever.recuperarContexto(usuario.finca_id, descripcionVisual)
        : 'Sin contexto agronómico disponible.'

      const finca = usuario.finca_id ? await getFincaById(usuario.finca_id) : null
      
      // 3. Diagnóstico Clínico (Verified Knowledge)
      const diagnostico = await _llm!.diagnosticarSintomaV2VK(descripcionVisual, contextoRag, {
        transcripcion: descripcionVisual,
        finca_id: usuario.finca_id ?? '',
        usuario_id: usuario.id,
        nombre_usuario: usuario.nombre ?? undefined,
        finca_nombre: finca?.nombre,
        cultivo_principal: finca?.cultivo_principal ?? undefined,
        pais: finca?.pais,
      }, traceId)

      const tipoEventoFinal = diagnostico.tipo_evento_sugerido === 'sin_evento' || !diagnostico.tipo_evento_sugerido
        ? 'observacion' 
        : diagnostico.tipo_evento_sugerido

      const eventoId = await saveEvento({
        finca_id: usuario.finca_id!,
        lote_id: null, // Si necesitamos el lote, podríamos preguntar después, pero en fase 3 lo omitimos de la primera pasada
        tipo_evento: tipoEventoFinal as any,
        status: diagnostico.requiere_accion_inmediata ? 'requires_review' : 'complete',
        datos_evento: { 
          descripcion_visual: descripcionVisual,
          diagnostico: diagnostico.diagnostico_final,
          recomendacion: diagnostico.recomendacion_tecnica,
          severidad: diagnostico.severidad,
          media_ref: imageUrl
        },
        descripcion_raw: descripcionVisual,
        confidence_score: diagnostico.confianza,
        requiere_validacion: diagnostico.confianza < 0.6,
        created_by: usuario.id,
        mensaje_id: mensajeId,
      })

      await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })

      let respuesta = `*Diagnóstico*: ${diagnostico.diagnostico_final}\n`
      if (diagnostico.severidad) respuesta += `*Severidad*: ${diagnostico.severidad}\n`
      if (diagnostico.recomendacion_tecnica) respuesta += `\n*Recomendación*: ${diagnostico.recomendacion_tecnica}`

      await _sender!.enviarTexto(msg.from, respuesta)
    } catch (err) {
      console.error('[EventHandler] Error en V2VK:', err)
      await _sender!.enviarTexto(msg.from, 'Hubo un error analizando tu imagen. Tu asesor la revisará manualmente. ⚠️')
      // Fallback a observación genérica
      const eventoId = await saveEvento({
        finca_id: usuario.finca_id!,
        lote_id: null,
        tipo_evento: 'observacion',
        status: 'requires_review',
        datos_evento: { texto_libre: `Imagen recibida (Falló IA)`, media_ref: imageUrl },
        descripcion_raw: `Error en análisis de imagen`,
        confidence_score: 0,
        requiere_validacion: true,
        created_by: usuario.id,
        mensaje_id: mensajeId,
      })
      await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })
    }
    return
  } else {
    // Otros (documento ya manejado arriba)
    await _sender!.enviarTexto(msg.from, 'Formato no soportado por ahora. ⚠️')
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
      const stored = session.contexto_parcial as { extracted_data: EventoCampoExtraido[]; transcripcion_original: string }
      const eventos = stored.extracted_data
      const descRaw = stored.transcripcion_original ?? transcripcion

      const idsGenerados: string[] = []
      let confirmaciones: string[] = []

      for (const ext of eventos) {
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
          datos_evento: enriquecerDatosEventoInfraestructura({
            ...ext.campos_extraidos,
            ...(ext.lote_detectado_raw != null ? { lote_detectado_raw: ext.lote_detectado_raw } : {}),
            _meta: {
              confidence_por_campo: ext.confidence_por_campo,
              campos_faltantes: ext.campos_faltantes,
            },
          }),
          descripcion_raw: descRaw,
          confidence_score: ext.confidence_score,
          requiere_validacion: ext.requiere_validacion || ext.confidence_score < 0.5,
          fecha_evento: ext.fecha_evento,
          created_by: usuario.id,
          mensaje_id: mensajeId,
        })
        
        if (eventoId) idsGenerados.push(eventoId)

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

        const loteName = ext.lote_id ? (lotes.find(l => l.lote_id === ext.lote_id)?.nombre_coloquial ?? undefined) : undefined
        confirmaciones.push(buildConfirmacion(ext, evStatus, loteName))
      }

      await actualizarMensaje(mensajeId, { status: 'processed', ...(idsGenerados.length > 0 ? { evento_id: idsGenerados[0] } : {}) })
      await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })

      // Enviar resumen de confirmación
      const mensajeConfirmacion = confirmaciones.length > 1 
        ? `¡Listo! Guardé tus reportes:\n\n${confirmaciones.map(c => `• ${c.replace('✅ ', '')}`).join('\n')}\n\n✅`
        : confirmaciones[0] ?? '✅ Registrado.'
      await _sender!.enviarTexto(msg.from, mensajeConfirmacion)
      return
    }

    // El usuario quiere corregir → detectar intención y re-extraer con tipos_forzados si aplica
    const stored = session.contexto_parcial as { extracted_data?: EventoCampoExtraido[]; transcripcion_original?: string }
    const transcripcionMerged = stored.transcripcion_original
      ? `Corrección del agricultor: ${transcripcion}. Contexto previo (puede estar incorrecto): ${stored.transcripcion_original}`
      : transcripcion

    const tipoPrevio = (stored.extracted_data?.[0]?.tipo_evento ?? 'nota_libre') as Parameters<NonNullable<typeof _intentDetector>['detectar']>[0]['tipo_previo']
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

    const multiExtractionCorreccion = await _llm!.extraerEventos(entradaCorreccion, traceId)

    if (multiExtractionCorreccion.eventos.length > 0 && !multiExtractionCorreccion.eventos.every(e => e.tipo_evento === 'sin_evento')) {
      const eventosValidos = multiExtractionCorreccion.eventos.filter(e => e.tipo_evento !== 'sin_evento')
      
      // Validar lote también en el path de corrección
      const eventoConLoteInvalido = eventosValidos.find(e => e.lote_detectado_raw && !e.lote_id && lotes.length > 0)
      if (eventoConLoteInvalido) {
        const listaLotes = lotes.map(l => `• ${l.nombre_coloquial}`).join('\n')
        await updateSession(session.session_id, {
          status: 'active',
          clarification_count: 1,
          contexto_parcial: { original_transcripcion: transcripcionMerged },
        })
        await _sender!.enviarTexto(
          msg.from,
          `El lote "${eventoConLoteInvalido.lote_detectado_raw}" no está registrado en tu finca. Los lotes disponibles son:\n${listaLotes}\n\n¿En cuál fue?`
        )
        await actualizarMensaje(mensajeId, { status: 'processing' })
        return
      }

      await updateSession(session.session_id, {
        status: 'pending_confirmation',
        clarification_count: 0,
        contexto_parcial: {
          extracted_data: eventosValidos as unknown as Record<string, unknown>[],
          transcripcion_original: transcripcionMerged,
        },
      })
      
      const bloquesCorr = eventosValidos.map(e => buildResumenParaConfirmar(e, lotes))
      let mensajeCorr: string
      if (bloquesCorr.length === 1) {
        mensajeCorr = `Esto es lo que entendí:\n\n${bloquesCorr[0]}\n\nResponde *sí* para guardar o corrígeme si algo está mal.`
      } else {
        const numeradosCorr = bloquesCorr.map((b, i) => `${i + 1}. ${b}`).join('\n\n')
        mensajeCorr = `Esto es lo que entendí de tu corrección:\n\n${numeradosCorr}\n\nResponde *sí* para guardar todo, o corrígeme si algo está mal.`
      }

      await _sender!.enviarTexto(msg.from, mensajeCorr)
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

  // En modo clarificación los tipos de evento ya fueron determinados en el turno anterior.
  // Forzarlos evita que el clasificador re-interprete el mensaje combinado y añada eventos
  // adicionales (p.ej. un insumo por "planteo aplicar X" dentro de una respuesta de plaga).
  const tiposPrevios = session.clarification_count > 0 && session.contexto_parcial['extracted_data']
    ? (session.contexto_parcial['extracted_data'] as EventoCampoExtraido[])
        .map(e => e.tipo_evento)
        .filter((t): t is NonNullable<EventoCampoExtraido['tipo_evento']> => !!t && t !== 'sin_evento' && t !== 'observacion')
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
    ...(tiposPrevios?.length ? { tipos_forzados: tiposPrevios as any } : {}),
    ...(session.contexto_parcial['extracted_data'] ? { estado_parcial: session.contexto_parcial['extracted_data'] as EventoCampoExtraido[] } : {}),
  }

  const multiExtraction = await _llm!.extraerEventos(entrada, traceId)

  // Mensajes que no son eventos de campo (saludo, consulta)
  if (multiExtraction.eventos.length === 1 && multiExtraction.eventos[0]?.tipo_evento === 'sin_evento') {
    const respuesta = multiExtraction.pregunta_sugerida ?? '¿En qué te puedo ayudar?'
    await _sender!.enviarTexto(msg.from, respuesta)
    await actualizarMensaje(mensajeId, { status: 'processed' })
    await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
    return
  }

  // Verificar lote: mencionado pero no coincide, O no mencionado con múltiples lotes activos
  const TIPOS_REQUIEREN_LOTE = new Set(['labor', 'insumo', 'plaga', 'cosecha', 'calidad'])
  const eventoConLoteInvalido = multiExtraction.eventos.find(e => e.lote_detectado_raw && !e.lote_id && lotes.length > 0)
  const eventoSinLoteConAmbiguedad = !eventoConLoteInvalido && lotes.length > 1
    ? multiExtraction.eventos.find(e => !e.lote_id && !e.lote_detectado_raw && TIPOS_REQUIEREN_LOTE.has(e.tipo_evento))
    : undefined
  const eventoLoteProblema = eventoConLoteInvalido ?? eventoSinLoteConAmbiguedad

  if (eventoLoteProblema) {
    if (session.clarification_count < 2) {
      const listaLotes = lotes.map(l => `• ${l.nombre_coloquial}`).join('\n')
      await updateSession(session.session_id, {
        clarification_count: session.clarification_count + 1,
        contexto_parcial: { original_transcripcion: transcripcionCombinada, extracted_data: multiExtraction.eventos as unknown as Record<string, unknown>[] },
      })
      const preguntaLote = eventoConLoteInvalido
        ? `No encontré el lote "${eventoConLoteInvalido.lote_detectado_raw}" en tu finca. Tus lotes disponibles son:\n${listaLotes}\n\n¿En cuál fue?`
        : `¿En qué lote fue? Tus lotes disponibles son:\n${listaLotes}`
      await _sender!.enviarTexto(msg.from, preguntaLote)
      await actualizarMensaje(mensajeId, { status: 'processing' })
      return
    }

    // P2: límite de 2 clarificaciones alcanzado — guardar como nota_libre para revisión del asesor
    const eventoId = await saveEvento({
      finca_id: usuario.finca_id!,
      lote_id: null,
      tipo_evento: 'nota_libre',
      status: 'requires_review',
      datos_evento: { texto_libre: transcripcionCombinada, motivo: 'lote_no_resuelto_tras_2_intentos' },
      descripcion_raw: transcripcionCombinada,
      confidence_score: 0,
      requiere_validacion: true,
      created_by: usuario.id,
      mensaje_id: mensajeId,
    })
    await updateSession(session.session_id, { status: 'completed', clarification_count: 0, contexto_parcial: {} })
    await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId ?? undefined })
    await _sender!.enviarTexto(msg.from, 'Guardé tu reporte para que tu asesor lo revise. ⚠️')
    return
  }

  // Clarificación pendiente (Regla 2: máx 2 preguntas) usando la pregunta unificada
  const requiereClarificacion = multiExtraction.eventos.some(e => e.requiere_clarificacion)
  if (requiereClarificacion && session.clarification_count < 2) {
    await updateSession(session.session_id, {
      clarification_count: session.clarification_count + 1,
      contexto_parcial: { original_transcripcion: transcripcionCombinada, extracted_data: multiExtraction.eventos as unknown as Record<string, unknown>[] },
    })
    const pregunta = multiExtraction.pregunta_sugerida ?? '¿Puedes contarme más detalles sobre esto?'
    await _sender!.enviarTexto(msg.from, pregunta)
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  // ── Mostrar resumen y esperar confirmación antes de guardar ───────────────
  await updateSession(session.session_id, {
    status: 'pending_confirmation',
    contexto_parcial: {
      extracted_data: multiExtraction.eventos as unknown as Record<string, unknown>[],
      transcripcion_original: transcripcion,
    },
  })

  // Generar resumen unificado — un solo mensaje, un solo "Responde sí"
  const bloques = multiExtraction.eventos.map(e => buildResumenParaConfirmar(e, lotes))
  let mensajeResumen: string
  if (bloques.length === 1) {
    mensajeResumen = `Esto es lo que entendí:\n\n${bloques[0]}\n\nResponde *sí* para guardar o corrígeme si algo está mal.`
  } else {
    const numerados = bloques.map((b, i) => `${i + 1}. ${b}`).join('\n\n')
    mensajeResumen = `Esto es lo que entendí de tus ${bloques.length} reportes:\n\n${numerados}\n\nResponde *sí* para guardar todo, o corrígeme si algo está mal.`
  }

  await _sender!.enviarTexto(msg.from, mensajeResumen)
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

  // Campos técnicos/internos que no tienen valor para el agricultor en la confirmación
  const SKIP = new Set([
    'lote_detectado_raw', '_meta', 'requiere_accion', 'urgencia',
    'nombre_cientifico',       // agronómico, no conversacional
    'pct_afectado',            // porcentaje técnico raramente mencionado por el agricultor
    'dosis_litros_equivalente', // conversión interna, el agricultor habla en bombadas/sacos
    'kg_equivalente',          // ídem
    'clasificacion_sugerida',  // metadato del extractor, no dato del campo
  ])
  const lineas: string[] = []
  for (const [k, v] of Object.entries(extracted.campos_extraidos)) {
    if (SKIP.has(k) || v === null || v === undefined) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (SKIP.has(k2) || v2 === null || v2 === undefined) continue
        lineas.push(`• ${k2}: ${v2}`)
      }
    } else {
      lineas.push(`• ${k}: ${v}`)
    }
  }

  // Returns only the event block — header/footer are assembled by the caller
  return `${tipo}\n${loteLinea}${fechaLinea}${lineas.join('\n')}`
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

