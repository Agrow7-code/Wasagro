import { PgBoss } from 'pg-boss'
import { procesarMensajeEntrante } from '../pipeline/procesarMensajeEntrante.js'
import { sendOTPViaWhatsApp } from '../auth/whatsappAuthService.js'
import { langfuse } from '../integrations/langfuse.js'
import { crearLLM } from '../integrations/llm/index.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { EntradaEvento, EventoCampoExtraido } from '../types/dominio/EventoCampo.js'
import { saveEvento, marcarIntencionCompletada, marcarIntencionFallida } from '../pipeline/supabaseQueries.js'
import { enriquecerDatosEventoInfraestructura } from '../pipeline/derivadorInfraestructura.js'
import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'
import { getUserByPhone } from '../pipeline/supabaseQueries.js'

let boss: PgBoss

const RATE_LIMIT_WAIT_BASE_MS = 5_000
const MAX_CONSECUTIVE_429 = 5
let consecutive429Count = 0
let activeThreads = 0
let maxThreads = 3

function parseRetryAfterMs(err: unknown): number | null {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    const match = msg.match(/retry.?after[:\s]*(\d+)/)
    if (match?.[1]) return parseInt(match[1], 10) * 1000
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) {
      return RATE_LIMIT_WAIT_BASE_MS * Math.pow(2, Math.min(consecutive429Count, 4))
    }
  }
  return null
}

async function procesarIntencionWorker(
  data: {
    tipo_evento: string
    entrada: EntradaEvento
    traceId: string
    sessionId: string
    mensajeId: string
    usuarioId: string
    fincaId: string
    transaccionOriginal: string
    phone: string
  },
  jobId: string,
  llm: IWasagroLLM,
): Promise<void> {
  activeThreads++

  const trace = langfuse.trace({ id: data.traceId })
  const generation = trace.generation({
    name: `procesar_intencion_${data.tipo_evento}`,
    model: 'wasagro-sub-agent',
    input: { tipo_evento: data.tipo_evento, job_id: jobId },
  })

  try {
    const entrada: EntradaEvento = {
      ...data.entrada,
      tipo_forzado: data.tipo_evento as EntradaEvento['tipo_forzado'],
      tipos_forzados: [data.tipo_evento] as NonNullable<EntradaEvento['tipos_forzados']>,
    }

    const multiExtraction = await llm.extraerEventos(entrada, data.traceId)

    if (multiExtraction.eventos.length === 0 || multiExtraction.eventos[0]?.tipo_evento === 'sin_evento') {
      await marcarIntencionFallida(data.sessionId, jobId, 'sin_evento_detectado')
      generation.end({ output: { status: 'sin_evento' }, metadata: { tipo_evento: data.tipo_evento } })
      return
    }

    const ext = multiExtraction.eventos[0] as EventoCampoExtraido

    // --- REGLA DETERMINISTA (Backend) ---
    // En lugar de confiar en que el LLM decida si falta algo (alucinaciones),
    // lo comprobamos en duro con código.
    if (ext.tipo_evento === 'plaga') {
      const c = ext.campos_extraidos as Record<string, unknown>
      const faltanIndividuos = !c['individuos_encontrados'] && !c['pct_afectado']
      const faltaMuestra = !c['tamano_muestra']
      const faltaOrgano = !c['organo_afectado']

      if (faltanIndividuos || faltaMuestra || faltaOrgano) {
        ext.requiere_clarificacion = true
        if (faltanIndividuos && faltaMuestra) {
          ext.pregunta_sugerida = "¿Cuántos individuos encontraste y en cuántas plantas o área hiciste el muestreo?"
        } else if (faltaMuestra || faltaOrgano) {
          ext.pregunta_sugerida = "¿Cuántas plantas muestreaste y en qué parte de la planta viste la plaga (hojas, tallo, hijo, racimo)?"
        } else if (faltanIndividuos) {
          ext.pregunta_sugerida = "¿Cuántos insectos o plantas afectadas encontraste en esa muestra?"
        } else {
          ext.pregunta_sugerida = "¿En qué parte específica de la planta la encontraste (hojas, tallo, hijo, racimo)?"
        }
      } else {
        ext.requiere_clarificacion = false
      }
    }

    const { supabase } = await import('../integrations/supabase.js')
    const { data: sData } = await supabase.from('sesiones_activas').select('*').eq('session_id', data.sessionId).single()

    // UX Rule: Max 1 clarification per event to avoid interrogation loops in the field.
    const maxClarificationsReached = (sData?.clarification_count ?? 0) >= 1

    if (ext.requiere_clarificacion && ext.pregunta_sugerida && !maxClarificationsReached) {
      // Flujo interactivo desde el background: pedimos el dato faltante
      const sender = crearSenderWhatsApp()
      const destinatario = data.phone

      // En lugar de guardar en BD y cerrar, preparamos la sesión para la respuesta
      if (sData) {
        const ctx = sData.contexto_parcial as Record<string, unknown>
        const intenciones = (ctx['intenciones_pendientes'] as any[]) ?? []
        
        // Removemos o marcamos como completada esta intención para que no bloquee
        const actualizadas = intenciones.map(i => 
          i.job_id === jobId ? { ...i, status: 'completed', evento_extraido: { _es_clarificacion: true } } : i
        )

        const completadas = actualizadas.filter(i => i.status === 'completed').length
        const fallidas = actualizadas.filter(i => i.status === 'failed').length
        const todasCompletas = completadas + fallidas === actualizadas.length && completadas > 0

        await supabase.from('sesiones_activas').update({
          // MANTENEMOS ESTADO ACTIVE (o lo forzamos) para recibir la respuesta
          status: 'active',
          clarification_count: (sData.clarification_count ?? 0) + 1,
          contexto_parcial: {
            ...ctx,
            intenciones_pendientes: actualizadas,
            completadas,
            fallidas,
            original_transcripcion: data.transaccionOriginal,
            extracted_data: [ext],
          }
        }).eq('session_id', data.sessionId)

        if (destinatario) {
          await sender.enviarTexto(destinatario, ext.pregunta_sugerida).catch(() => {})
        }

        // Si esta era la última intención, revisamos si hay otras que completaron bien para avisar
        if (todasCompletas && completadas > 1) {
          // Extraemos las que NO son de clarificación
          const completadasReales = actualizadas.filter(i => i.status === 'completed' && !i.evento_extraido?._es_clarificacion)
          if (completadasReales.length > 0) {
            await sender.enviarTexto(destinatario, `(Y ya registré los otros ${completadasReales.length} reportes ✅)`).catch(() => {})
          }
        }
      }

      generation.end({ output: { status: 'clarification_requested' }, metadata: { tipo_evento: data.tipo_evento } })
      consecutive429Count = 0
      return
    }

    const tipo_evento = (ext.requiere_clarificacion && maxClarificationsReached) ? ext.tipo_evento : ext.tipo_evento
    const evStatus = (ext.confidence_score < 0.5 || (ext.requiere_clarificacion && maxClarificationsReached)) ? 'requires_review' : 'complete'

    if (ext.alerta_urgente) {
      langfuse.trace({ id: data.traceId }).event({
        name: 'alerta_plaga_urgente',
        level: 'WARNING',
        input: { finca_id: data.fincaId, campos: ext.campos_extraidos },
      })
    }

    const eventoId = await saveEvento({
      finca_id: data.fincaId,
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
      descripcion_raw: data.transaccionOriginal,
      confidence_score: ext.confidence_score,
      requiere_validacion: ext.requiere_validacion || ext.confidence_score < 0.5,
      fecha_evento: ext.fecha_evento,
      created_by: data.usuarioId,
      mensaje_id: data.mensajeId,
    })

    const { todas_completas, intenciones, transaccion_original } = await marcarIntencionCompletada(
      data.sessionId,
      jobId,
      ext as unknown as Record<string, unknown>,
      eventoId ?? '',
    )

    generation.end({
      output: { status: 'checkpoint_saved', evento_id: eventoId, todas_completas },
      metadata: { tipo_evento: data.tipo_evento, confidence: ext.confidence_score },
    })

    consecutive429Count = 0

    if (todas_completas) {
      const completadas = intenciones.filter(i => i.status === 'completed')
      const fallidas = intenciones.filter(i => i.status === 'failed')

      if (completadas.length > 0) {
        const sender = crearSenderWhatsApp()
        const confirmaciones = completadas.map(i => {
          const extData = i.evento_extraido as unknown as EventoCampoExtraido
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
          const label = labels[extData?.tipo_evento ?? ''] ?? 'reporte'
          const isReview = extData?.confidence_score != null && extData.confidence_score < 0.5
          if (isReview) return 'Registré tu reporte. Lo revisa tu asesor pronto. ✅'
          return `✅ Registré tu ${label}.`
        })

        const msg = confirmaciones.length > 1
          ? `¡Listo! Guardé tus reportes:\n\n${confirmaciones.map(c => `• ${c.replace('✅ ', '')}`).join('\n')}\n\n✅`
          : (confirmaciones[0] ?? '✅ Registrado.')

        // El teléfono viene en la carga útil del job desde el orquestador
        const destinatario = data.phone

        if (destinatario) {
          await sender.enviarTexto(destinatario, msg).catch((err) => {
            console.error('[procesar-intencion] Error enviando WhatsApp:', err)
          })
        }

      }
    }
  } catch (err: unknown) {
    const retryAfter = parseRetryAfterMs(err)

    if (retryAfter !== null) {
      consecutive429Count++

      if (consecutive429Count >= MAX_CONSECUTIVE_429) {
        console.error(`[procesar-intencion] 🛑 STOP — ${MAX_CONSECUTIVE_429} errores 429 consecutivos. Abortando job ${jobId}.`)
        maxThreads = Math.max(1, maxThreads - 1)
        await marcarIntencionFallida(data.sessionId, jobId, `rate_limit_stop:${String(err)}`)
        generation.end({ output: { status: 'rate_limit_stop', error: String(err) }, level: 'ERROR' })
        throw err
      }

      console.warn(`[procesar-intencion] ⏳ WAIT — 429 Rate Limit. Backoff ${retryAfter}ms antes de reintentar job ${jobId}.`)
      if (activeThreads > 1) {
        maxThreads = Math.max(1, activeThreads - 1)
        console.warn(`[procesar-intencion] 📉 CAP — Reduciendo maxThreads a ${maxThreads}`)
      }

      await new Promise(resolve => setTimeout(resolve, retryAfter))
      throw err
    }

    const errMsg = err instanceof Error ? err.message : String(err)
    const isServerError = errMsg.includes('50') || errMsg.includes('timeout') || errMsg.includes('ECONNREFUSED')

    if (isServerError) {
      console.error(`[procesar-intencion] 🛑 STOP — Server error en job ${jobId}: ${errMsg}`)
      await marcarIntencionFallida(data.sessionId, jobId, `server_error:${errMsg}`)
      generation.end({ output: { status: 'server_error', error: errMsg }, level: 'ERROR' })
    } else {
      console.error(`[procesar-intencion] Error en job ${jobId}:`, err)
      await marcarIntencionFallida(data.sessionId, jobId, `error:${errMsg}`)
      generation.end({ output: { status: 'error', error: errMsg }, level: 'ERROR' })
    }

    throw err
  } finally {
    activeThreads--
  }
}

export async function initPgBoss(): Promise<PgBoss> {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL requerida para pg-boss')
  }

  boss = new PgBoss(connectionString)

  boss.on('error', (error) => console.error('[pg-boss] Error:', error))

  await boss.start()
  console.log('[pg-boss] Iniciado correctamente')

  await boss.createQueue('procesar-mensaje')
  await boss.createQueue('enviar-otp-whatsapp')
  await boss.createQueue('procesar-intencion')

  await boss.work('procesar-mensaje', async (jobs) => {
    for (const job of jobs) {
      const { msg, traceId } = job.data as any
      console.log(`[pg-boss] procesando job ${job.id} de ${msg?.from ?? '?'} tipo=${msg?.tipo ?? '?'}`)
      try {
        await procesarMensajeEntrante(msg, traceId)
        console.log(`[pg-boss] job ${job.id} completado OK`)
      } catch (err) {
        console.error(`[pg-boss] job ${job.id} falló: ${String(err)}`)
        langfuse.trace({ id: traceId }).event({
          name: 'job_attempt_failed',
          level: 'ERROR',
          output: { error: String(err), jobId: job.id },
        })
        throw err
      }
    }
  })

  const llmForWorker = crearLLM()

  await boss.work('procesar-intencion', { localConcurrency: maxThreads, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      console.log(`[pg-boss] procesar-intencion job ${job.id} tipo=${(job.data as any)?.tipo_evento}`)
      try {
        await procesarIntencionWorker(job.data as any, job.id, llmForWorker)
        console.log(`[pg-boss] procesar-intencion job ${job.id} completado OK`)
      } catch (err) {
        console.error(`[pg-boss] procesar-intencion job ${job.id} falló: ${String(err)}`)
        throw err
      }
    }
  })

  await boss.work('enviar-otp-whatsapp', async (jobs) => {
    for (const job of jobs) {
      const { phone, code, traceId } = job.data as { phone: string; code: string; traceId: string }
      const trace = langfuse.trace({ id: traceId, name: 'otp_whatsapp_send', input: { phone } })
      try {
        await sendOTPViaWhatsApp(phone, code)
        trace.event({ name: 'otp_whatsapp_sent', output: { phone } })
        console.log(`[pg-boss] OTP enviado por WhatsApp a ${phone.slice(-4)}***`)
      } catch (err) {
        trace.event({ name: 'otp_whatsapp_failed', level: 'ERROR', output: { error: String(err), jobId: job.id } })
        console.error(`[pg-boss] Error enviando OTP a ${phone.slice(-4)}***:`, err)
        throw err
      }
    }
  })

  return boss
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss no inicializado')
  return boss
}

export function isPgBossReady(): boolean {
  return !!boss
}
