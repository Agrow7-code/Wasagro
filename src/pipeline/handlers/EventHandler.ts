import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { EntradaEvento, EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { IEmbeddingService } from '../../integrations/llm/EmbeddingService.js'
import { guardarEmbeddingEnEvento } from '../supabaseQueries.js'
import { enriquecerDatosEventoInfraestructura } from '../derivadorInfraestructura.js'
import { buildFeedbackRecibo } from '../feedbackBuilder.js'
import {
  getUserByPhone,
  getFincaById,
  getLotesByFinca,
  getOrCreateSession,
  updateSession,
  saveEvento,
  actualizarEventoDatos,
  updateFincaCoordenadas,
  actualizarMensaje,
  getPendingAgricultoresByFinca,
  approveAgricultor,
  guardarLoteIntenciones,
  guardarCorreccionesSigatoka,
  type IntencionPendiente,
} from '../supabaseQueries.js'
import { transcribirAudio } from '../sttService.js'
import { handleDocumento, procesarFilasExcelConfirmadas } from '../procesarExcel.js'
import { _sender, _llm, _intentDetector, _ragRetriever, _embeddingService, ROLES_ADMIN } from '../procesarMensajeEntrante.js'
import type { CostContext } from '../../integrations/llm/IWasagroLLM.js'
import { downloadEvolutionMedia } from '../../integrations/whatsapp/EvolutionMediaClient.js'
import { getBoss } from '../../workers/pgBoss.js'
import { detectarFormularioSigatoka, buildDescripcionRaw, buildWhatsappSummary, mapearSectoresALotes, mapearSectoresALotesFilas, contarCeldasIlegibles, buildPreguntaAclaracion, aplicarAclaraciones, parseFincaUmbrales, UMBRALES_SEVERIDAD_DEFAULT } from './SigatokaHandler.js'
import {
  getUmbralesAlerta,
  upsertUmbralAlerta,
  upsertDecisionAlerta,
  getDecisionAlerta,
  getDecisionMakersByOrg,
  getAdminsByFinca,
} from '../supabaseQueries.js'
import { resolveUmbrales, toUmbralesSeveridad, shouldOutreach, PEST_ALERT_FIELDS, type OutreachConfig } from './umbralesAlerta.js'
import { reduceAlertConfig, type PendingAlertConfigCtx } from './alertConfigReducer.js'
import { entregarAlertaPlaga } from '../alertaEntrega.js'
import { isAlertDeliveryEnabled } from '../../workers/alertDeliveryGate.js'
import { markAlertaEntregada } from '../supabaseQueries.js'
import { normalizarPlaga } from '../plagaNormalizer.js'
import type { SigatokaMuestreo } from '../../types/dominio/SigatokaMuestreo.js'
import { evaluarCalidadSigatoka, decidirRecaptura } from '../../types/dominio/CalidadSigatoka.js'
import { subirImagenEvento } from '../../integrations/supabaseStorage.js'

// ─── Config constants for outreach policy (design §4.2) ───────────────────────

/**
 * Parse an env var as a positive integer with a fallback.
 * Guards against parseInt returning NaN on bad input (e.g. "abc"),
 * which would silently disable the cooldown / cap entirely (warning #7).
 */
function parseEnvInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const OUTREACH_CONFIG: OutreachConfig = {
  cooldownDays: parseEnvInt('OUTREACH_COOLDOWN_DAYS', 7),
  maxAsks: parseEnvInt('OUTREACH_MAX_ASKS', 3),
}

/** Mask a phone number to last 4 digits for log safety (P5/D31). */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****'
  return `****${phone.slice(-4)}`
}

// ─── Dedup store for proactive outreach (per phone+pest+finca+day) ────────────
// In-memory dedup for outreach sends within a single process restart. A persistent
// dedup (Redis/Postgres) is a PR#3b enhancement; the decision_alerta cooldown
// provides the cross-restart guard at a 7-day granularity.
const _outreachSentToday = new Set<string>()

/** Exported for test teardown only — clears the in-process dedup set. */
export function _resetOutreachDedupForTest(): void {
  _outreachSentToday.clear()
}

function outreachDedupKey(phone: string, pestType: string, fincaId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `${phone}:${pestType}:${fincaId}:${day}`
}

function isOutreachDedupHit(phone: string, pestType: string, fincaId: string): boolean {
  return _outreachSentToday.has(outreachDedupKey(phone, pestType, fincaId))
}

function markOutreachSent(phone: string, pestType: string, fincaId: string): void {
  _outreachSentToday.add(outreachDedupKey(phone, pestType, fincaId))
}

async function resolverMediaImagen(msg: NormalizedMessage, traceId: string): Promise<{ base64: string; mimeType: string } | null> {
  if (msg.mediaBase64) return { base64: msg.mediaBase64, mimeType: msg.mediaMimetype ?? 'image/jpeg' }

  const apiUrl = process.env['EVOLUTION_API_URL']
  const apiKey = process.env['EVOLUTION_API_KEY']
  const instance = process.env['EVOLUTION_INSTANCE']

  if (!apiUrl || !apiKey || !instance) {
    langfuse.trace({ id: traceId }).event({ name: 'media_download_skipped', level: 'WARNING', input: { reason: 'env_vars_missing' } })
    return null
  }

  try {
    return await downloadEvolutionMedia(msg.rawPayload, apiUrl, apiKey, instance)
  } catch (err) {
    langfuse.trace({ id: traceId }).event({ name: 'media_download_failed', level: 'ERROR', input: { error: String(err) } })
    return null
  }
}

// ─── Flujo de reporte de campo ─────────────────────────────────────────────

export async function handleEvento(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  // Trace de event pipeline — tags por pipeline + tipo media + rol del usuario.
  langfuse.trace({
    id: traceId,
    name: 'event_pipeline',
    tags: ['event', msg.tipo, usuario.rol],
    metadata: { usuario_id: usuario.id, phone: msg.from, finca_id: usuario.finca_id ?? null, org_id: usuario.org_id },
  })

  const costCtx: CostContext | undefined = usuario.org_id ? { orgId: usuario.org_id, fincaId: usuario.finca_id ?? undefined } : undefined

  // Approval command: "aprobar [nombre]" from jefe/propietario (text only, before audio processing)
  if (msg.tipo === 'texto' && ROLES_ADMIN.has(usuario.rol) && usuario.finca_id) {
    const approvalMatch = (msg.texto ?? '').toLowerCase().match(/^aprobar\s+(.+)/)
    if (approvalMatch) {
      await handleAprobacion(msg, usuario, mensajeId, traceId, approvalMatch[1]?.trim() ?? '')
      return
    }
  }

  // T3.11 — Opt-out/opt-in keyword handler (BillingIntentHandler pattern, design §4.5)
  // "desactivar alertas {pest}" / "activar alertas {pest}" from decision-makers.
  // Fires regardless of session state. Scoped to decision-makers (admin_org/director).
  if (msg.tipo === 'texto' && (usuario.rol === 'admin_org' || usuario.rol === 'director') && usuario.org_id) {
    const handled = await handleAlertOptOutKeyword(msg, usuario, mensajeId)
    if (handled) return
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
    const docUsuario: { id: string; finca_id: string | null; org_id?: string; finca_nombre?: string; cultivo_principal?: string } = { id: usuario.id, finca_id: usuario.finca_id, org_id: usuario.org_id }
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
    await _sender!.enviarTexto(msg.from, '✅ Recibí tu audio, lo estoy procesando...')
    // CDN URLs de Evolution API requieren auth Bearer — igual que D8 para imágenes
    let audioInput: string | Buffer = msg.audioUrl ?? msg.mediaId ?? ''
    const evApiUrl = process.env['EVOLUTION_API_URL']
    const evApiKey = process.env['EVOLUTION_API_KEY']
    const evInstance = process.env['EVOLUTION_INSTANCE']
    if (evApiUrl && evApiKey && evInstance) {
      try {
        const media = await downloadEvolutionMedia(msg.rawPayload, evApiUrl, evApiKey, evInstance)
        audioInput = Buffer.from(media.base64, 'base64')
      } catch (downloadErr) {
        langfuse.trace({ id: traceId }).event({
          name: 'audio_download_failed',
          level: 'WARNING',
          input: { error: String(downloadErr), wamid: msg.wamid },
        })
      }
    }
    const audioRef = typeof audioInput === 'string' ? audioInput : '[buffer]'
    try {
      transcripcion = await transcribirAudio(audioInput, traceId)
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
    if (!msg.imagenUrl && !msg.mediaBase64) {
      await _sender!.enviarTexto(msg.from, 'No pude procesar la imagen enviada. ⚠️')
      return
    }

    await _sender!.enviarTexto(msg.from, 'Analizando tu imagen... 🔍')

    const media = await resolverMediaImagen(msg, traceId)

    if (!media) {
      await _sender!.enviarTexto(msg.from, 'No pude descargar la imagen. ¿Puedes mandarla de nuevo? ⚠️')
      await actualizarMensaje(mensajeId, { status: 'error', error_detail: 'media_download_failed' })
      return
    }

    const finca = usuario.finca_id ? await getFincaById(usuario.finca_id) : null
    const lotes = usuario.finca_id ? await getLotesByFinca(usuario.finca_id) : []
    const lista_lotes = lotes.map(l => `- ${l.lote_id}: "${l.nombre_coloquial}"`).join('\n') || 'Sin lotes'
    const lotesRef = lotes.map(l => ({ lote_id: l.lote_id, nombre: l.nombre_coloquial ?? '' }))

    // Persistir la imagen original ANTES de extraer. Es el "raw" auditable del
    // evento (P5) y el insumo para revisión humana / re-captura. Nunca bloquea:
    // si Storage falla, imagenPath queda null y el evento se guarda igual (P4).
    const imagenPath = await subirImagenEvento(media.base64, media.mimeType, usuario.finca_id ?? 'sin-finca')

    try {
      // Detección de Sigatoka en dos vías PARALELAS (sin latencia extra):
      // - detectarFichaSigatoka: pregunta binaria enfocada, fiable para leer el
      //   título Dole/LOGBAN que el clasificador multiopción se pierde.
      // - clasificarTipoImagen: clasificador general para el resto de imágenes.
      // El `true` del detector binario gana: rutea directo al extractor (tier
      // ultra/Gemini, sano) y evita el OCR genérico.
      const [esSigatoka, tipoBase] = await Promise.all([
        _llm!.detectarFichaSigatoka(media.base64, media.mimeType, traceId, costCtx),
        _llm!.clasificarTipoImagen(media.base64, media.mimeType, traceId, msg.texto ?? undefined, costCtx),
      ])
      const tipoImagen = esSigatoka ? 'muestreo_sigatoka_banano' : tipoBase

      langfuse.trace({ id: traceId }).event({ name: 'imagen_clasificada', input: { tipo: tipoImagen, detector_sigatoka: esSigatoka, tipo_base: tipoBase } })

      // Fast path: clasificador detectó visualmente un formulario Sigatoka.
      // Salteamos el OCR genérico (no transcribe matrices fiablemente) y vamos
      // directo al extractor sp-03e. Ahorra ~8-14s + 1 llamada LLM.
      if (tipoImagen === 'muestreo_sigatoka_banano') {
        langfuse.trace({ id: traceId }).event({ name: 'sigatoka_form_detected', input: { source: 'classifier_direct' } })

        // Pase de calidad ANTES de la extracción pesada: si la foto está cortada
        // o ilegible, pedimos otra y no gastamos el extractor ni guardamos basura.
        // Con cap (P2): tras MAX_RECAPTURA_SIGATOKA pedidos, procesamos igual la
        // foto (el extractor marca lo ilegible → requires_review) en vez de
        // insistir infinitamente. El contador vive en la sesión.
        const calidad = await _llm!.evaluarCalidadFichaSigatoka(media.base64, media.mimeType, traceId, costCtx)
        const veredicto = evaluarCalidadSigatoka(calidad)
        const sesionSig = await getOrCreateSession(msg.from, 'reporte')
        const intentosRecaptura = Number(sesionSig.contexto_parcial['sigatoka_recaptura_count'] ?? 0)

        if (decidirRecaptura(veredicto.aceptable, intentosRecaptura) === 'pedir') {
          langfuse.trace({ id: traceId }).event({ name: 'sigatoka_recaptura', input: { problema: veredicto.problema, motivo: calidad.motivo, intento: intentosRecaptura + 1 } })
          await updateSession(sesionSig.session_id, { contexto_parcial: { ...sesionSig.contexto_parcial, sigatoka_recaptura_count: intentosRecaptura + 1 } })
          await _sender!.enviarTexto(msg.from, veredicto.mensaje ?? 'No pude leer bien la foto. ¿Puedes mandarla de nuevo? ⚠️')
          await actualizarMensaje(mensajeId, { status: 'processed' })
          return
        }

        // Procesamos: calidad OK, o llegamos al cap (no insistimos más, P2).
        if (!veredicto.aceptable) {
          langfuse.trace({ id: traceId }).event({ name: 'sigatoka_recaptura_cap', level: 'WARNING', input: { intentos: intentosRecaptura, problema: veredicto.problema } })
        }
        if (intentosRecaptura > 0) {
          await updateSession(sesionSig.session_id, { contexto_parcial: { ...sesionSig.contexto_parcial, sigatoka_recaptura_count: 0 } })
        }

        const sigatoka = await _llm!.extraerMuestreoSigatoka(media.base64, media.mimeType, traceId, costCtx)
        sigatoka.puntosMuestreo = mapearSectoresALotes(sigatoka.puntosMuestreo, lotesRef)
        sigatoka.plantas11sem = mapearSectoresALotesFilas(sigatoka.plantas11sem, lotesRef)
        sigatoka.plantas00sem = mapearSectoresALotesFilas(sigatoka.plantas00sem ?? [], lotesRef)
        await finalizarMuestreoSigatoka(sigatoka, {
          from: msg.from, fincaId: usuario.finca_id!, orgId: usuario.org_id ?? '', usuarioId: usuario.id, mensajeId,
          imagenPath, caption: msg.texto ?? null,
          datosExtra: { classifier_source: esSigatoka ? 'sp-03g_binary' : 'sp-03c_direct' },
          traceId, costCtx,
        })
        return
      }

      if (tipoImagen === 'documento_tabla') {
      const ocr = await _llm!.extraerDocumentoOCR(media.base64, media.mimeType, {
        finca_nombre: finca?.nombre,
        cultivo_principal: finca?.cultivo_principal ?? undefined,
        lista_lotes,
      }, traceId, costCtx)

        // Sub-clasificación: el OCR genérico ya extrajo el texto. Si contiene marcadores
        // del formulario de muestreo de Sigatoka, ramificamos al extractor especializado
        // (sp-03e). Si no, seguimos con la persistencia del OCR genérico.
        if (detectarFormularioSigatoka(ocr.texto_completo_visible)) {
          langfuse.trace({ id: traceId }).event({ name: 'sigatoka_form_detected', input: { ocr_confianza: ocr.confianza_lectura } })

          const sigatoka = await _llm!.extraerMuestreoSigatoka(media.base64, media.mimeType, traceId, costCtx)
          sigatoka.puntosMuestreo = mapearSectoresALotes(sigatoka.puntosMuestreo, lotesRef)
          sigatoka.plantas11sem = mapearSectoresALotesFilas(sigatoka.plantas11sem, lotesRef)
          sigatoka.plantas00sem = mapearSectoresALotesFilas(sigatoka.plantas00sem ?? [], lotesRef)
          await finalizarMuestreoSigatoka(sigatoka, {
            from: msg.from, fincaId: usuario.finca_id!, orgId: usuario.org_id ?? '', usuarioId: usuario.id, mensajeId,
            imagenPath, caption: msg.texto ?? null,
            datosExtra: { texto_ocr_origen: ocr.texto_completo_visible },
            traceId, costCtx,
          })
          return
        }

        const eventoId = await saveEvento({
          finca_id: usuario.finca_id!,
          lote_id: null,
          tipo_evento: 'observacion',
          status: ocr.confianza_lectura >= 0.5 ? 'complete' : 'requires_review',
        datos_evento: {
          tipo_documento: ocr.tipo_documento,
          fecha_documento: ocr.fecha_documento,
          registros: ocr.registros,
          texto_completo: ocr.texto_completo_visible,
          confianza_lectura: ocr.confianza_lectura,
          advertencia: ocr.advertencia,
          caption: msg.texto ?? null,
        },
          descripcion_raw: ocr.texto_completo_visible || 'Documento fotografiado',
          confidence_score: ocr.confianza_lectura,
          requiere_validacion: ocr.confianza_lectura < 0.5,
          imagen_path: imagenPath,
          created_by: usuario.id,
          mensaje_id: mensajeId,
        })

        await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId ?? undefined })

        if (ocr.confianza_lectura < 0.3 || ocr.advertencia?.includes('imagen borrosa')) {
          await _sender!.enviarTexto(msg.from, 'La imagen está borrosa y no pude leer bien los datos. ¿Puedes mandar una foto más clara o escribirme los datos? ⚠️')
        } else {
          const nRegistros = ocr.registros.length
          await _sender!.enviarTexto(msg.from, `Leí tu documento. Encontré ${nRegistros} registro${nRegistros !== 1 ? 's' : ''} para revisar. Tu asesor los revisará y te confirma. ✅`)
        }
        return
      }

      // plaga_cultivo u otro → pipeline V2VK
      const contextoExtra = msg.texto ? `\nNota del agricultor: ${msg.texto}` : ''
      const descripcionVisual = await _llm!.describirImagenVisual(
        `data:${media.mimeType};base64,${media.base64}`,
        traceId,
        costCtx,
      )

      const contextoRag = usuario.finca_id && _ragRetriever
        ? await _ragRetriever.recuperarContexto(usuario.finca_id, descripcionVisual + contextoExtra)
        : ''

      const diagnostico = await _llm!.diagnosticarSintomaV2VK(descripcionVisual + contextoExtra, contextoRag, {
        transcripcion: descripcionVisual,
        finca_id: usuario.finca_id ?? '',
        usuario_id: usuario.id,
        nombre_usuario: usuario.nombre ?? undefined,
        finca_nombre: finca?.nombre,
        cultivo_principal: finca?.cultivo_principal ?? undefined,
        pais: finca?.pais,
      }, traceId, costCtx)

      const tipoEventoFinal = diagnostico.tipo_evento_sugerido === 'sin_evento' || !diagnostico.tipo_evento_sugerido
        ? 'observacion'
        : diagnostico.tipo_evento_sugerido

      const eventoId = await saveEvento({
        finca_id: usuario.finca_id!,
        lote_id: null,
        tipo_evento: tipoEventoFinal as any,
        status: diagnostico.requiere_accion_inmediata ? 'requires_review' : 'complete',
        datos_evento: {
          descripcion_visual: descripcionVisual,
          diagnostico: diagnostico.diagnostico_final,
          recomendacion: diagnostico.recomendacion_tecnica,
          severidad: diagnostico.severidad,
          caption: msg.texto ?? null,
        },
        descripcion_raw: descripcionVisual,
        confidence_score: diagnostico.confianza,
        requiere_validacion: diagnostico.confianza < 0.6,
        imagen_path: imagenPath,
        created_by: usuario.id,
        mensaje_id: mensajeId,
      })

      await actualizarMensaje(mensajeId, { status: 'processed', evento_id: eventoId })

      let respuesta = `*Diagnóstico*: ${diagnostico.diagnostico_final}`
      if (diagnostico.recomendacion_tecnica) respuesta += `\n\n*Recomendación*: ${diagnostico.recomendacion_tecnica}`

      await _sender!.enviarTexto(msg.from, respuesta)
    } catch (err) {
      console.error('[EventHandler] Error procesando imagen:', err)
      langfuse.trace({ id: traceId }).event({ name: 'imagen_pipeline_error', level: 'ERROR', input: { error: String(err), wamid: msg.wamid } })
      await _sender!.enviarTexto(msg.from, 'Tuve un error con tu imagen. Mándamela de nuevo o descríbeme lo que ves. ⚠️')
      await saveEvento({
        finca_id: usuario.finca_id!,
        lote_id: null,
        tipo_evento: 'observacion',
        status: 'requires_review',
        datos_evento: { error: String(err), caption: msg.texto ?? null },
        descripcion_raw: 'Error procesando imagen',
        confidence_score: 0,
        requiere_validacion: true,
        imagen_path: imagenPath,
        created_by: usuario.id,
        mensaje_id: mensajeId,
      })
      await actualizarMensaje(mensajeId, { status: 'error', error_detail: String(err) })
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

  // ── Aclaración de celdas ilegibles de Sigatoka (follow-up al tomador) ─────
  if (session.status === 'pending_sigatoka_aclaracion') {
    const cp = session.contexto_parcial as {
      sigatoka_evento_id?: string
      sigatoka_datos_evento?: Record<string, unknown>
      sigatoka_ubicaciones?: Array<{ punto: string; sector: string | null; campo: string }>
    }
    const eventoId = cp.sigatoka_evento_id
    const datos = cp.sigatoka_datos_evento
    const ubicaciones = cp.sigatoka_ubicaciones ?? []

    // Estado corrupto/incompleto → salida limpia (el evento ya quedó persistido).
    if (!eventoId || !datos || ubicaciones.length === 0) {
      await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
      await _sender!.enviarTexto(msg.from, '¿Qué quieres registrar?')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }

    const respuestas = await _llm!.interpretarAclaracionSigatoka(
      transcripcion,
      ubicaciones.map(u => ({ punto: u.punto, campo: u.campo })),
      traceId,
      costCtx,
    )
    const sigatokaPrev = datos['sigatoka'] as SigatokaMuestreo

    // Feedback loop (CR5): persistir las respuestas del tomador como correcciones
    // con fuente 'tomador_whatsapp'. valor_extraido=null/estado=ilegible porque solo
    // el tomador puede clarificar celdas que el modelo no pudo leer. Nunca tumba el flujo (P4).
    // Usar el finca_id real del usuario autenticado que envía la aclaración.
    // Si no está disponible, no insertar (mejor ausencia que contaminar el flywheel).
    const fincaIdReal = usuario.finca_id ?? null
    const feedbackRows = fincaIdReal
      ? respuestas
          .filter(r => r.valor != null)
          .map(r => ({
            evento_id: eventoId,
            finca_id: fincaIdReal,
            punto: r.punto,
            campo: r.campo,
            valor_extraido: null as number | null,
            estado_extraido: 'ilegible',
            valor_corregido: r.valor,
            fuente: 'tomador_whatsapp' as const,
            creado_por: null,
          }))
      : []
    if (!fincaIdReal) {
      langfuse.trace({ id: traceId }).event({
        name: 'sigatoka_feedback_sin_finca',
        level: 'WARNING',
        input: { evento_id: eventoId, usuario_id: usuario.id },
      })
    }
    if (feedbackRows.length > 0) {
      guardarCorreccionesSigatoka(feedbackRows).catch(err => {
        langfuse.trace({ id: traceId }).event({
          name: 'sigatoka_feedback_error',
          level: 'ERROR',
          input: { error: String(err) },
        })
      })
    }

    const actualizado = aplicarAclaraciones(sigatokaPrev, respuestas)
    datos['sigatoka'] = actualizado

    const nuevoStatus = actualizado.requiereValidacion ? 'requires_review' : 'complete'
    await actualizarEventoDatos(eventoId, datos, nuevoStatus, actualizado.requiereValidacion)

    const ileg = contarCeldasIlegibles(actualizado.puntosMuestreo, actualizado.plantas11sem, actualizado.plantas00sem ?? [])

    // P2: una sola repregunta. Si tras la primera respuesta aún quedan celdas
    // ilegibles y no agotamos la cuota, repreguntamos por las que faltan.
    if (ileg.ruta === 'preguntar' && session.clarification_count < 1) {
      await updateSession(session.session_id, {
        status: 'pending_sigatoka_aclaracion',
        clarification_count: session.clarification_count + 1,
        contexto_parcial: { sigatoka_evento_id: eventoId, sigatoka_datos_evento: datos, sigatoka_ubicaciones: ileg.ubicaciones },
      })
      await _sender!.enviarTexto(msg.from, buildPreguntaAclaracion(ileg.ubicaciones))
      await actualizarMensaje(mensajeId, { status: 'processing' })
      return
    }

    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    const restantes = ileg.total
    const mensajeFinal = restantes === 0
      ? '✅ Listo, completé los valores que faltaban. ¡Gracias!'
      : `✅ Gracias. ${restantes} valor${restantes > 1 ? 'es' : ''} sigue${restantes > 1 ? 'n' : ''} sin definir — tu asesor lo revisa.`
    await _sender!.enviarTexto(msg.from, mensajeFinal)
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  // ── Config de umbral de alerta — respuesta del decision-maker ────────────
  // Fires when a decision-maker is in the multi-turn threshold-config conversation
  // opened proactively by the system (design §4.3, §4.4, T3.9).
  if (session.status === 'pending_alert_config') {
    await handleAlertConfigSession(session, transcripcion, mensajeId)
    return
  }

  // ── Confirmación pendiente: el usuario responde al resumen ────────────────
  if (session.status === 'pending_confirmation') {
    const respuesta = transcripcion.toLowerCase().trim()

    // Comando explícito de escape o rechazo total
    if (/^(cancelar|abortar|salir|borrar|ignorar|no|nop|nada)/.test(respuesta)) {
      await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
      await _sender!.enviarTexto(msg.from, '❌ Reporte cancelado. La sesión fue limpiada.\n\n¿Qué quieres registrar de nuevo?')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }

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

        // PR#3b — Canonical pest-alert delivery at confirmation point.
        // The event is now persisted (eventos_campo row exists) so we have a real
        // eventId for the idempotency guard. This is the ONLY delivery path for
        // non-Sigatoka pest alerts; the pgBoss extraction-stage call remains gated OFF.
        // Runs async (best-effort, P4) — never blocks the farmer's confirmation message.
        if (ext.alerta_urgente && eventoId && isAlertDeliveryEnabled() && usuario.finca_id) {
          const plagaInfo = normalizarPlaga(
            ext.campos_extraidos['plaga_tipo'] as string | null | undefined,
            finca?.cultivo_principal,
          )
          const pestType = plagaInfo?.plaga_tipo ?? (ext.campos_extraidos['plaga_tipo'] as string | undefined) ?? 'desconocida'
          const pestNombreComun = plagaInfo?.nombre_comun ?? pestType
          const isQuarantine = plagaInfo?.alerta_cuarentena ?? false
          const orgId = usuario.org_id ?? ''

          // M12 is_first_alert: determined by decision_alerta.ask_count.
          // ask_count reflects how many times we have already outreached for this
          // (org, finca, pest). ask_count=0 (or no row) → first alert ever for this pair.
          // Non-quarantine only: quarantine always fires regardless.
          const isFirstAlertPromise = (!isQuarantine && orgId)
            ? getDecisionAlerta(orgId, usuario.finca_id, pestType)
                .then(row => (row?.ask_count ?? 0) === 0)
                .catch(() => false)
            : Promise.resolve(false)

          const sender = _sender!
          const founderPhone = process.env['FOUNDER_PHONE'] ?? undefined

          isFirstAlertPromise.then(isFirstAlert => {
            return entregarAlertaPlaga(
              {
                finca_id: usuario.finca_id!,
                org_id: orgId,
                pest_type: pestType,
                pest_nombre_comun: pestNombreComun,
                is_quarantine: isQuarantine,
                campos_extraidos: ext.campos_extraidos as Record<string, unknown>,
                traceId,
                is_first_alert: isFirstAlert,
              },
              {
                sender,
                getAdminsByFinca,
                getDecisionMakersByOrg,
                getUmbralesAlerta: (oId, fId, pType) => getUmbralesAlerta(oId, fId, pType),
                founderPhone,
                founderShadow: process.env['ALERT_FOUNDER_SHADOW'] === 'true',
                // Real idempotency: keyed by evento_id so pgBoss handler retries cannot re-deliver.
                markAlertaEntregada: (eId) => markAlertaEntregada(eId),
                eventId: eventoId,
              },
            )
          }).then(deliveryResult => {
            langfuse.trace({ id: traceId }).event({
              name: 'alerta_plaga_delivery',
              output: deliveryResult ?? { alert_sent: false, error: 'delivery_threw' },
            })
          }).catch((err: unknown) => {
            console.error('[EventHandler] entregarAlertaPlaga error (non-blocking):', err)
            langfuse.trace({ id: traceId }).event({
              name: 'alerta_plaga_delivery_error',
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
      costCtx,
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

      const multiExtractionCorreccion = await _llm!.extraerEventos(entradaCorreccion, traceId, costCtx)

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

      // Validar si requiere clarificación (ej. falta cantidad de plaga)
      const eventoAClarificar = eventosValidos.find(e => e.requiere_clarificacion && e.pregunta_sugerida)
      if (eventoAClarificar) {
        // P2: máximo 2 preguntas — si ya se preguntó 2 veces, registrar como nota_libre
        if (session.clarification_count >= 2) {
          langfuse.trace({ id: traceId }).event({ name: 'max_clarifications_reached', level: 'WARNING', input: { count: session.clarification_count, wamid: msg.wamid } })
          for (const ext of eventosValidos) {
            await saveEvento({
              finca_id: usuario.finca_id!,
              lote_id: ext.lote_id,
              tipo_evento: 'nota_libre',
              descripcion_raw: transcripcionMerged,
              datos_evento: { ...ext.campos_extraidos, _meta: { campos_faltantes: ext.campos_faltantes } },
              confidence_score: ext.confidence_score,
              status: 'requires_review',
              requiere_validacion: true,
              created_by: usuario.id,
            })
          }
          await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
          await _sender!.enviarTexto(msg.from, 'No pude completar todos los datos. Guardé tu reporte para que tu asesor lo revise. ⚠️')
          await actualizarMensaje(mensajeId, { status: 'processed' })
          return
        }
        await updateSession(session.session_id, {
          status: 'pending_confirmation',
          clarification_count: session.clarification_count + 1,
          contexto_parcial: {
            extracted_data: eventosValidos as unknown as Record<string, unknown>[],
            transcripcion_original: transcripcionMerged,
          },
        })
        await _sender!.enviarTexto(msg.from, eventoAClarificar.pregunta_sugerida!)
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
      
      const mensajeCorr = buildFeedbackRecibo(eventosValidos, lotes)

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

  // ── Extracción — IntentGate + pg-boss por intención ──────────────────────
  const transcripcionCombinada = session.clarification_count > 0 && session.contexto_parcial['original_transcripcion']
    ? `${String(session.contexto_parcial['original_transcripcion'])} ${transcripcion}`
    : transcripcion

  const contexto_rag = usuario.finca_id && _ragRetriever
    ? await _ragRetriever.recuperarContexto(usuario.finca_id, transcripcionCombinada)
    : undefined

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

      const intentResult = await _llm!.clasificarIntenciones(entrada, traceId, costCtx)

  if (intentResult.es_no_evento) {
    if (intentResult.tipo_no_evento === 'saludo') {
      await _sender!.enviarTexto(msg.from, '¡Hola! ¿Qué pasó hoy en la finca?')
    } else if (intentResult.tipo_no_evento === 'consulta') {
      await _sender!.enviarTexto(msg.from, 'Claro, ¿qué necesitas? Si tienes algo que reportar de la finca, mándame el mensaje.')
    } else {
      const pregunta = intentResult.mensaje_clarificacion ?? '¿Puedes contarme más sobre lo que pasó en la finca?'
      await _sender!.enviarTexto(msg.from, pregunta)
    }
    await actualizarMensaje(mensajeId, { status: 'processed' })
    await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
    return
  }

  if (intentResult.intenciones.length === 0) {
    await _sender!.enviarTexto(msg.from, intentResult.mensaje_clarificacion ?? 'No pude identificar qué evento reportas. ¿Me lo explicas de otra forma?')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    await updateSession(session.session_id, { clarification_count: 0, status: 'completed' })
    return
  }

  // ── IntentGate aprobado → Encolar cada intención a pg-boss ──────────────
  if (session.clarification_count === 0) {
    await _sender!.enviarTexto(msg.from, `Procesando tus ${intentResult.intenciones.length} reporte${intentResult.intenciones.length > 1 ? 's' : ''}... 🔍`)
  }

  const boss = getBoss()
  const intencionesPendientes: IntencionPendiente[] = []

  for (const intencion of intentResult.intenciones) {
    const jobId = await boss.send('procesar-intencion', {
      tipo_evento: intencion.tipo_evento,
      entrada,
      traceId,
      sessionId: session.session_id,
      mensajeId,
      usuarioId: usuario.id,
      orgId: usuario.org_id,
      fincaId: usuario.finca_id,
      transaccionOriginal: transcripcion,
      phone: msg.from,
    }, {
      retryLimit: 3,
      retryBackoff: true,
      retryDelay: 5,
    })

    intencionesPendientes.push({
      tipo_evento: intencion.tipo_evento,
      job_id: jobId ?? '',
      status: 'pending',
      evento_extraido: null,
      evento_id: null,
    })

    langfuse.trace({ id: traceId }).event({
      name: 'intencion_encolada',
      input: { tipo_evento: intencion.tipo_evento, job_id: jobId },
    })
  }

  await guardarLoteIntenciones(session.session_id, intencionesPendientes, transcripcion)
  await actualizarMensaje(mensajeId, { status: 'processing' })
}

// Persiste el muestreo, responde el resumen y —si quedan 1-5 celdas ilegibles—
// abre el follow-up "preguntar al tomador" (estado pending_sigatoka_aclaracion).
// El evento se guarda SIEMPRE primero (P4): si el tomador no responde, no se pierde.
async function finalizarMuestreoSigatoka(
  sigatoka: SigatokaMuestreo,
  ctx: {
    from: string
    fincaId: string
    orgId: string
    usuarioId: string
    mensajeId: string
    imagenPath: string | null
    caption: string | null
    datosExtra: Record<string, unknown>
    traceId: string
    costCtx?: CostContext | undefined
  },
): Promise<void> {
  const datos_evento: Record<string, unknown> = {
    tipo_documento: 'muestreo_sigatoka_banano',
    sigatoka,
    caption: ctx.caption,
    ...ctx.datosExtra,
  }

  const eventoId = await saveEvento({
    finca_id: ctx.fincaId,
    lote_id: null,
    tipo_evento: 'observacion',
    status: sigatoka.requiereValidacion ? 'requires_review' : 'complete',
    datos_evento,
    descripcion_raw: buildDescripcionRaw(sigatoka),
    confidence_score: sigatoka.confidenceScore,
    requiere_validacion: sigatoka.requiereValidacion,
    imagen_path: ctx.imagenPath,
    created_by: ctx.usuarioId,
    mensaje_id: ctx.mensajeId,
  })

  await actualizarMensaje(ctx.mensajeId, { status: 'processed', evento_id: eventoId ?? undefined })

  // T1.14 + Fix 2: Dual-read threshold resolution with explicit fail-safe (design §4.1, §7).
  // Priority: table rows → dual-read fincas.config → UMBRALES_SEVERIDAD_DEFAULT.
  // The fail-safe is EXPLICIT: thresholds are NEVER undefined (never all-Infinity/silent).
  // No-regression invariant: J>10, I>5, M<9 always fire even when table is empty
  // and orgId is empty-string (e.g. legacy user without org_id).
  // Cutover (PR#4): remove dual-read branch; table is then the only source.
  let umbralesFinca = UMBRALES_SEVERIDAD_DEFAULT
  try {
    const tableRows = await getUmbralesAlerta(ctx.orgId, ctx.fincaId, 'sigatoka_negra')
    const resolved = resolveUmbrales(tableRows)
    if (resolved !== null) {
      umbralesFinca = toUmbralesSeveridad(resolved)
    } else {
      // Table has no rows → unconfigured path
      if (process.env['ALERT_THRESHOLDS_DUAL_READ'] === 'true') {
        // Dual-read fallback during cutover window: table has no rows yet → use fincas.config
        const fincaData = await getFincaById(ctx.fincaId)
        const parsed = parseFincaUmbrales(fincaData?.config ?? null)
        if (parsed !== null) umbralesFinca = parsed
        // else: umbralesFinca stays UMBRALES_SEVERIDAD_DEFAULT — J/I/M still fire
      }
      // T3.6 — Proactive outreach: no configured threshold → ask decision-makers (§4.1, §4.2)
      // Runs async (best-effort) — does not block the reporter's summary delivery.
      // Only fires when org_id is available (legacy users without org_id are skipped, P2).
      if (ctx.orgId) {
        outreachDecisionMakers(ctx.orgId, ctx.fincaId, 'sigatoka_negra', new Date()).catch(err => {
          console.warn('[EventHandler] outreachDecisionMakers error (non-blocking):', err)
        })
      }
    }
    if (process.env['SIGATOKA_UMBRAL_EE2_LEVE']) {
      console.warn('[EventHandler] SIGATOKA_UMBRAL_EE2_LEVE env var is deprecated — configure ee2Leve via umbrales_alerta table instead')
    }
  } catch (err) {
    // On DB error: umbralesFinca stays UMBRALES_SEVERIDAD_DEFAULT — thresholds never silenced
    console.warn('[EventHandler] Error resolving umbrales, using UMBRALES_SEVERIDAD_DEFAULT:', err)
  }

  await _sender!.enviarTexto(ctx.from, buildWhatsappSummary(sigatoka, umbralesFinca))

  const ileg = contarCeldasIlegibles(sigatoka.puntosMuestreo, sigatoka.plantas11sem, sigatoka.plantas00sem ?? [])
  if (ileg.ruta === 'preguntar' && eventoId) {
    const session = await getOrCreateSession(ctx.from, 'reporte')
    await updateSession(session.session_id, {
      status: 'pending_sigatoka_aclaracion',
      clarification_count: 0,
      contexto_parcial: {
        sigatoka_evento_id: eventoId,
        sigatoka_datos_evento: datos_evento,
        sigatoka_ubicaciones: ileg.ubicaciones,
      },
    })
    await _sender!.enviarTexto(ctx.from, buildPreguntaAclaracion(ileg.ubicaciones))
  }
}

// ─── handleAlertOptOutKeyword — T3.11 ────────────────────────────────────────
// BillingIntentHandler-style detector for "desactivar/activar alertas {pest}" from
// decision-makers (design §4.5). One-turn: detects the keyword, upserts the enabled
// state across all catalog campos for that pest, updates decision_alerta, confirms.
// Returns true if the keyword was handled (caller should return early).
//
// Keywords (case-insensitive):
//   "desactivar alertas [pest]" / "desactivar alertas de [pest]"
//   "activar alertas [pest]" / "activar alertas de [pest]"
const ALERT_DEACTIVATE_RE = /\b(desactivar|deshabilitar|silenciar|apagar)\s+alertas?\b/i
const ALERT_ACTIVATE_RE = /\b(activar|habilitar|encender)\s+alertas?\b/i

async function handleAlertOptOutKeyword(
  msg: NormalizedMessage,
  usuario: { id: string; org_id: string; rol: string },
  mensajeId: string,
): Promise<boolean> {
  const text = msg.texto ?? ''

  const isDeactivate = ALERT_DEACTIVATE_RE.test(text)
  const isActivate = ALERT_ACTIVATE_RE.test(text)

  if (!isDeactivate && !isActivate) return false

  // Extract pest type — look for known pest names in the message
  let pestType: string | null = null
  const lower = text.toLowerCase()
  for (const pt of Object.keys(PEST_ALERT_FIELDS)) {
    // Match canonical form or display variant (e.g. "sigatoka" matches "sigatoka_negra")
    if (lower.includes(pt.replace(/_/g, ' ')) || lower.includes(pt.replace(/_/g, ''))) {
      pestType = pt
      break
    }
  }

  if (!pestType) {
    // Keyword matched but no recognized pest — not our handler
    return false
  }

  const fields = PEST_ALERT_FIELDS[pestType] ?? []
  if (fields.length === 0) return false

  const enabled = isActivate

  // We need a finca_id to target. Decision-makers may not have a direct finca_id.
  // For opt-out keywords, we set org-level enabled state (finca_id=null → org default).
  // This is a best-effort opt-out: per-org-default rows get toggled.
  // The caller ensures usuario.org_id is present.
  for (const field of fields) {
    await upsertUmbralAlerta({
      org_id: usuario.org_id,
      finca_id: null,
      pest_type: pestType,
      campo: field.campo,
      operador: field.operador,
      valor: field.default,
      enabled,
    })
  }

  // Fix #3 — if the DM is currently in a pending_alert_config session, reset it.
  // Without this, a DM who opts out mid-config stays locked in the config flow.
  // We reset their session to 'active' so the next message is handled normally.
  try {
    const dmSession = await getOrCreateSession(msg.from, 'reporte')
    if (dmSession.status === 'pending_alert_config') {
      await updateSession(dmSession.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    }
  } catch (err) {
    // Non-fatal: session reset failure is logged but does not block the keyword response (P4)
    console.warn('[AlertOptOut] failed to reset pending_alert_config session:', { phone: maskPhone(msg.from), err })
  }

  // For org-level opt-out we cannot scope to a single finca — skip decision_alerta upsert
  // (decision_alerta requires finca_id NOT NULL per DDL). Log the action for observability.
  console.info('[AlertOptOut] keyword handler applied', {
    phone: maskPhone(msg.from),
    org_id: usuario.org_id,
    pest_type: pestType,
    enabled,
  })

  await actualizarMensaje(mensajeId, { status: 'processed' })
  if (enabled) {
    await _sender!.enviarTexto(msg.from, `✅ Alertas de ${pestType.replace(/_/g, ' ')} activadas.`)
  } else {
    await _sender!.enviarTexto(msg.from, `✅ Alertas de ${pestType.replace(/_/g, ' ')} desactivadas. Podés activarlas escribiendo "activar alertas ${pestType.replace(/_/g, ' ')}".`)
  }
  return true
}

// ─── handleAlertConfigSession — T3.9 ──────────────────────────────────────────
// Handles an inbound message from a decision-maker whose session is in
// 'pending_alert_config' state (design §4.4, M11).
//
// The session shape (PendingAlertConfigCtx) contains:
//   pest_type, finca_id, org_id, pending_campos, collected, current_campo, turn
//
// After each turn, we dispatch reduceAlertConfig(ctx, reply) and act on the
// returned action:
//   ask_next  → update session ctx, send next campo prompt
//   persist   → upsert all collected rows + decided decision_alerta + close session
//   abort     → close session silently (P2), log
//   opted_out → upsert enabled=false + opted_out decision_alerta + close session
//   clarify   → update session turn, re-prompt the same campo
async function handleAlertConfigSession(
  session: Awaited<ReturnType<typeof getOrCreateSession>>,
  reply: string,
  mensajeId: string,
): Promise<void> {
  const ctx = session.contexto_parcial as unknown as PendingAlertConfigCtx

  // Corrupted context guard — must have pest_type + finca_id + org_id at minimum
  if (!ctx.pest_type || !ctx.finca_id || !ctx.org_id) {
    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    await _sender!.enviarTexto(session.phone, '¿Qué quieres registrar?')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  const result = reduceAlertConfig(ctx, reply)

  if (result.action === 'ask_next') {
    // More campos to collect — advance the session and ask next
    await updateSession(session.session_id, {
      contexto_parcial: result.ctx as unknown as Record<string, unknown>,
    })
    const nextPrompt = buildCampoPrompt(result.ctx)
    await _sender!.enviarTexto(session.phone, nextPrompt)
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  if (result.action === 'persist' && result.upsertPayload) {
    // All campos collected — upsert rows + mark as decided
    for (const row of result.upsertPayload) {
      await upsertUmbralAlerta({
        org_id: row.org_id,
        finca_id: row.finca_id,
        pest_type: row.pest_type,
        campo: row.campo,
        operador: getDefaultOperador(row.pest_type, row.campo),
        valor: row.valor,
        enabled: row.enabled,
      })
    }
    // Fix #4: preserve ask_count from ctx (carried from outreach) instead of hardcoding 1,
    // so the cap-3 anti-spam guard stays accurate across persist/opted_out terminal upserts.
    await upsertDecisionAlerta({
      org_id: ctx.org_id,
      finca_id: ctx.finca_id,
      pest_type: ctx.pest_type,
      status: 'decided',
      asked_at: new Date().toISOString(),
      ask_count: ctx.ask_count ?? 1,
    })
    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    await _sender!.enviarTexto(session.phone, '✅ Listo, configuré los umbrales de alerta. Te avisamos cuando los niveles superen lo configurado.')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  if (result.action === 'opted_out' && result.upsertPayload) {
    // User opted out — disable all campos
    for (const row of result.upsertPayload) {
      await upsertUmbralAlerta({
        org_id: row.org_id,
        finca_id: row.finca_id,
        pest_type: row.pest_type,
        campo: row.campo,
        operador: getDefaultOperador(row.pest_type, row.campo),
        valor: row.valor,
        enabled: false,
      })
    }
    // Fix #4: preserve ask_count from ctx (same reason as persist path above)
    await upsertDecisionAlerta({
      org_id: ctx.org_id,
      finca_id: ctx.finca_id,
      pest_type: ctx.pest_type,
      status: 'opted_out',
      asked_at: new Date().toISOString(),
      ask_count: ctx.ask_count ?? 1,
    })
    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    await _sender!.enviarTexto(session.phone, '✅ Listo, no te enviaremos alertas de esta plaga. Podés activarlas cuando quieras escribiendo "activar alertas [plaga]".')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  if (result.action === 'clarify') {
    // Non-numeric reply — re-ask same campo (turn incremented in reducer)
    await updateSession(session.session_id, {
      contexto_parcial: result.ctx as unknown as Record<string, unknown>,
    })
    const campoLabel = getCampoLabel(ctx.pest_type, ctx.current_campo ?? '')
    await _sender!.enviarTexto(session.phone, `⚠️ Necesito un número. Por ejemplo: 10. ¿Cuál es el umbral para ${campoLabel}?`)
    await actualizarMensaje(mensajeId, { status: 'processing' })
    return
  }

  if (result.action === 'abort') {
    // Two non-numeric replies — abort (P2: max one re-ask per campo)
    console.warn('[EventHandler] pending_alert_config: aborted after max clarifications', {
      phone: maskPhone(session.phone),
      pest_type: ctx.pest_type,
      finca_id: ctx.finca_id,
    })
    await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
    // P4/UX: notify DM instead of going silent — they may retry or use the web UI
    const webUrl = process.env['DASHBOARD_URL'] ?? 'https://app.wasagro.com'
    await _sender!.enviarTexto(
      session.phone,
      `No pude configurar los umbrales — probá de nuevo más tarde o ingresá desde ${webUrl} 👉`,
    )
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  // Fallback (should not reach here)
  await updateSession(session.session_id, { status: 'active', clarification_count: 0, contexto_parcial: {} })
  await actualizarMensaje(mensajeId, { status: 'processed' })
}

/** Returns the default operador for a given pest/campo from the catalog. */
function getDefaultOperador(pestType: string, campo: string): 'gt' | 'gte' | 'lt' | 'lte' {
  const fields = PEST_ALERT_FIELDS[pestType] ?? []
  return fields.find(f => f.campo === campo)?.operador ?? 'gt'
}

/** Returns a human-readable label for a campo (for prompts). */
function getCampoLabel(pestType: string, campo: string): string {
  const fields = PEST_ALERT_FIELDS[pestType] ?? []
  return fields.find(f => f.campo === campo)?.label ?? campo
}

/**
 * Builds the WhatsApp prompt for the next campo in a pending_alert_config session.
 * One campo per turn (design §4.4, C decision). Includes the field default as reference.
 */
function buildCampoPrompt(ctx: PendingAlertConfigCtx): string {
  const campo = ctx.current_campo
  if (!campo) return '¿Qué valor quieres configurar?'
  const fields = PEST_ALERT_FIELDS[ctx.pest_type] ?? []
  const field = fields.find(f => f.campo === campo)
  if (!field) return `¿Cuál es el umbral para ${campo}? Escríbelo en números.`
  const direction = field.operador === 'lt' || field.operador === 'lte' ? 'mínimo' : 'máximo'
  return `¿Cuál es el ${direction} de *${field.label}* (${field.unit}) para alertar? (referencia: ${field.default}${field.unit})`
}

// ─── outreachDecisionMakers — T3.7 shared helper ──────────────────────────────
// Shared helper used by both EventHandler (Sigatoka path) and pgBoss (non-Sigatoka path).
// When pest data arrives with no configured threshold, this evaluates the decision_alerta
// state machine and, if outreach is due, proactively messages the org's decision-makers
// via Evolution to start the config conversation on THEIR phone (design §4.1, §4.3, §5).
//
// Returns true if outreach was sent (at least one DM notified).
export async function outreachDecisionMakers(
  orgId: string,
  fincaId: string,
  pestType: string,
  now: Date,
): Promise<boolean> {
  if (!_sender) {
    console.warn('[outreachDecisionMakers] sender not initialized')
    return false
  }

  // 1a. Fix #1 — check if org has explicitly disabled alerts via keyword opt-out.
  // The keyword handler sets umbrales_alerta rows to enabled=false (org-level, finca_id=null).
  // decision_alerta cannot capture this (it requires finca_id NOT NULL), so resolveUmbrales
  // returns null → we'd otherwise outreach again and again on each event.
  // Guard: if ANY row exists with enabled=false for this (org, pest) → treat as opted-out.
  try {
    const umbralesRows = await getUmbralesAlerta(orgId, fincaId, pestType)
    // All-disabled: every row is explicitly enabled=false → user opted out via keyword
    if (umbralesRows.length > 0 && umbralesRows.every(r => !r.enabled)) {
      return false
    }
  } catch {
    // Non-fatal: if the check fails, continue with normal decision_alerta logic (P4)
  }

  // 1b. Check decision_alerta state machine
  let decisionState = null
  try {
    decisionState = await getDecisionAlerta(orgId, fincaId, pestType)
  } catch (err) {
    console.warn('[outreachDecisionMakers] getDecisionAlerta error — skipping outreach:', err)
    return false
  }

  const decision = shouldOutreach(decisionState, now, OUTREACH_CONFIG)

  if (decision.action === 'silent') {
    return false
  }

  if (decision.action === 'escalate') {
    // Max asks reached — log for founder review (P7, no client spam)
    console.warn('[outreachDecisionMakers] max asks reached for org/finca/pest', {
      orgId, fincaId, pestType, ask_count: decisionState?.ask_count,
    })
    // No further outreach to decision-makers
    return false
  }

  // action: 'ask' or 're-ask'
  let decisionMakers = []
  try {
    decisionMakers = await getDecisionMakersByOrg(orgId)
  } catch (err) {
    console.warn('[outreachDecisionMakers] getDecisionMakersByOrg error — skipping outreach:', err)
    return false
  }

  if (decisionMakers.length === 0) {
    console.warn('[outreachDecisionMakers] no decision-makers found for org — skipping outreach', { orgId })
    return false
  }

  // 2. Resolve the campos to ask about
  const fields = PEST_ALERT_FIELDS[pestType] ?? []
  const enabledFields = fields.filter(f => f.operador !== undefined) // all catalog fields

  if (enabledFields.length === 0) {
    // Pest not in catalog — cannot configure; skip silently
    return false
  }

  const pendingCampos = enabledFields.map(f => f.campo)
  const firstCampo = pendingCampos[0]!

  const nextAskCount = (decisionState?.ask_count ?? 0) + 1

  // 3. Pre-scan: determine which DMs are reachable (not deferred) before claiming.
  // We must not upsert decision_alerta to 'asked' if every DM has an open session —
  // that would increment ask_count without anyone receiving the message.
  const { getOrCreateSession: _getOrCreate, updateSession: _updateSession } = await import('../supabaseQueries.js')

  // Collect reachable DMs (dedup-clean + no session collision)
  const reachableDMs: typeof decisionMakers = []
  for (const dm of decisionMakers) {
    const phone = dm.phone
    if (isOutreachDedupHit(phone, pestType, fincaId)) continue

    // T3.13 — Session collision deferral
    let existingSession = null
    try {
      const { data } = await (await import('../../integrations/supabase.js')).supabase
        .from('sesiones_activas')
        .select('session_id, status')
        .eq('phone', phone)
        .neq('status', 'completed')
        .neq('status', 'expired')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      existingSession = data
    } catch {
      continue  // On error, skip conservatively (P7)
    }

    if (existingSession) {
      console.warn('[outreachDecisionMakers] deferred — target phone has open session', {
        phone: maskPhone(phone), pestType, fincaId, existingStatus: existingSession.status,
      })
      continue
    }

    reachableDMs.push(dm)
  }

  if (reachableDMs.length === 0) {
    return false
  }

  // 5 (fix) — Claim-before-send: upsert decision_alerta to 'asked' BEFORE sending so a
  // concurrent replica sees 'asked' and skips outreach (closes the common race window).
  // We only claim if there is at least one reachable DM (pre-scan confirmed above).
  // The in-memory dedup set covers the same-process fast-path.
  try {
    await upsertDecisionAlerta({
      org_id: orgId,
      finca_id: fincaId,
      pest_type: pestType,
      status: 'asked',
      asked_at: now.toISOString(),
      ask_count: nextAskCount,
    })
  } catch (err) {
    console.warn('[outreachDecisionMakers] failed to claim decision_alerta before send — aborting to avoid double-send:', err)
    return false
  }

  // 4. For each reachable DM: SEND FIRST, THEN open session (fix #2).
  // A failed send must NOT leave a ghost pending_alert_config session.
  let sent = 0
  const firstField = enabledFields.find(f => f.campo === firstCampo)
  const direction = firstField?.operador === 'lt' || firstField?.operador === 'lte' ? 'mínimo' : 'máximo'
  const intro = `Detectamos ${pestType.replace(/_/g, ' ')} en la finca. Para poder alertarte cuando los niveles son críticos, necesito configurar los umbrales contigo.\n\n¿Cuál es el ${direction} de *${firstField?.label ?? firstCampo}* (${firstField?.unit ?? ''}) para alertar? (referencia: ${firstField?.default ?? '?'}${firstField?.unit ?? ''})`

  for (const dm of reachableDMs) {
    const phone = dm.phone

    // Build initial ctx for the config conversation, carrying ask_count for fix #4
    const configCtx: PendingAlertConfigCtx = {
      pest_type: pestType,
      finca_id: fincaId,
      org_id: orgId,
      pending_campos: pendingCampos,
      collected: {},
      current_campo: firstCampo,
      turn: 0,            // M11: reset on entry
      ask_count: nextAskCount,  // carry through for persist/opted_out upserts (fix #4)
    }

    let sendOk = false
    try {
      await _sender.enviarTexto(phone, intro)
      sendOk = true
      markOutreachSent(phone, pestType, fincaId)
      sent++
    } catch (err) {
      console.warn('[outreachDecisionMakers] enviarTexto failed for dm:', { phone: maskPhone(phone), err })
    }

    // Open pending_alert_config session ONLY after a successful send (fix #2)
    if (sendOk) {
      try {
        const dmSession = await _getOrCreate(phone, 'reporte')
        await _updateSession(dmSession.session_id, {
          status: 'pending_alert_config',
          clarification_count: 0,  // M11: reset clarification_count on entry
          contexto_parcial: configCtx as unknown as Record<string, unknown>,
        })
      } catch (err) {
        console.warn('[outreachDecisionMakers] failed to open session for dm:', { phone: maskPhone(phone), err })
        // Session failure after a successful send: the DM got the message but has no session.
        // Logged for observability (P4). Their next reply will hit the corrupted-ctx guard,
        // which resets gracefully.
      }
    }
  }

  return sent > 0
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

