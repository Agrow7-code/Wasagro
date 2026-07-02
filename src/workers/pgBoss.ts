import { PgBoss } from 'pg-boss'
import { procesarMensajeEntrante } from '../pipeline/procesarMensajeEntrante.js'
import { sendOTPViaWhatsApp } from '../auth/whatsappAuthService.js'
import { langfuse } from '../integrations/langfuse.js'
import { crearLLM } from '../integrations/llm/index.js'
import type { IWasagroLLM, CostContext } from '../integrations/llm/IWasagroLLM.js'
import type { EntradaEvento, EventoCampoExtraido } from '../types/dominio/EventoCampo.js'
import { marcarIntencionCompletada, marcarIntencionFallida } from '../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'
import { buildFeedbackRecibo } from '../pipeline/feedbackBuilder.js'
import { normalizarPlaga } from '../pipeline/plagaNormalizer.js'
import { canonicalPestType } from '../pipeline/handlers/umbralesAlerta.js'
import { handleFounderManualReply } from '../pipeline/handlers/FounderManualReplyHandler.js'

/** Mask a phone number to last 4 digits for log safety (P5/D31). */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****'
  return `****${phone.slice(-4)}`
}

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
    orgId?: string
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

    const multiExtraction = await llm.extraerEventos(entrada, data.traceId, data.orgId ? { orgId: data.orgId, fincaId: data.fincaId } satisfies CostContext : undefined)

    if (multiExtraction.eventos.length === 0 || multiExtraction.eventos[0]?.tipo_evento === 'sin_evento') {
      await marcarIntencionFallida(data.sessionId, jobId, 'sin_evento_detectado')
      generation.end({ output: { status: 'sin_evento' }, metadata: { tipo_evento: data.tipo_evento } })
      return
    }

    const ext = multiExtraction.eventos[0] as EventoCampoExtraido

    // --- REGLA DETERMINISTA (Backend) ---
    if (ext.tipo_evento === 'plaga') {
      const c = ext.campos_extraidos as Record<string, unknown>
      const faltanIndividuos = !c['individuos_encontrados'] && !c['pct_afectado']
      const faltaMuestra = !c['tamano_muestra']
      const faltaOrgano = !c['organo_afectado']

      if (faltanIndividuos || faltaMuestra || faltaOrgano) {
        ext.requiere_clarificacion = true
        if (faltanIndividuos && faltaMuestra && faltaOrgano) {
          ext.pregunta_sugerida = "¿Cuántas plantas muestreaste, cuántos insectos encontraste y en qué parte estaban (hojas, tallo, hijo, racimo)?"
        } else if (faltanIndividuos && faltaMuestra) {
          ext.pregunta_sugerida = "¿En cuántas plantas hiciste el muestreo y cuántos individuos encontraste en total?"
        } else if (faltaMuestra && faltaOrgano) {
          ext.pregunta_sugerida = "¿Cuántas plantas muestreaste y en qué parte viste la plaga (hojas, tallo, hijo, racimo)?"
        } else if (faltanIndividuos && faltaOrgano) {
          ext.pregunta_sugerida = "¿Cuántos insectos encontraste en la muestra y en qué parte de la planta estaban?"
        } else if (faltanIndividuos) {
          ext.pregunta_sugerida = "¿Cuántos individuos (insectos o daño) contabilizaste en esa muestra?"
        } else if (faltaMuestra) {
          ext.pregunta_sugerida = "¿En cuántas plantas en total realizaste este muestreo?"
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
          await sender.enviarTexto(destinatario, ext.pregunta_sugerida).catch(err => {
            console.warn('[pgBoss procesarIntencion] fallo al enviar pregunta de clarificación:', err)
          })
        }

        // Si esta era la última intención, revisamos si hay otras que completaron bien para avisar
        if (todasCompletas && completadas > 1) {
          // Extraemos las que NO son de clarificación
          const completadasReales = actualizadas.filter(i => i.status === 'completed' && !i.evento_extraido?._es_clarificacion)
          if (completadasReales.length > 0) {
            await sender.enviarTexto(destinatario, `(Y ya registré los otros ${completadasReales.length} reportes ✅)`).catch(err => {
              console.warn('[pgBoss procesarIntencion] fallo al enviar resumen de completadas:', err)
            })
          }
        }
      }

      generation.end({ output: { status: 'clarification_requested' }, metadata: { tipo_evento: data.tipo_evento } })
      consecutive429Count = 0
      return
    }

    // Normalizar nombre de plaga al canónico del cultivo (determinista, no depende del LLM)
    let alertaCuarentena = false
    let plagaNombreComun: string | null = null
    let plagaPestType: string | null = null

    if (ext.tipo_evento === 'plaga') {
      const c = ext.campos_extraidos as Record<string, unknown>
      const normalizado = normalizarPlaga(
        (c['plaga_tipo'] ?? c['nombre_comun']) as string | null,
        data.entrada.cultivo_principal ?? null,
      )
      if (normalizado) {
        ext.campos_extraidos = {
          ...c,
          plaga_tipo: normalizado.plaga_tipo,
          nombre_comun: normalizado.nombre_comun,
          nombre_cientifico: normalizado.nombre_cientifico,
        }
        alertaCuarentena = normalizado.alerta_cuarentena
        plagaNombreComun = normalizado.nombre_comun
        plagaPestType = canonicalPestType(normalizado.nombre_comun)
        if (normalizado.alerta_cuarentena) {
          ext.alerta_urgente = true
        }
        langfuse.trace({ id: data.traceId }).event({
          name: 'plaga_normalizada',
          input: { original: c['plaga_tipo'], normalizado: normalizado.plaga_tipo, cultivo: data.entrada.cultivo_principal },
        })
      }
    }

    if (ext.alerta_urgente) {
      langfuse.trace({ id: data.traceId }).event({
        name: 'alerta_plaga_urgente',
        level: 'WARNING',
        input: { finca_id: data.fincaId, campos: ext.campos_extraidos },
      })
      // Alert delivery is deferred to AFTER marcarIntencionCompletada below (P7 fix #2):
      // we must not notify about field data that hasn't been recorded yet.
    }

    // No guardar en DB todavía — esperamos confirmación del agricultor
    const { todas_completas, intenciones, transaccion_original } = await marcarIntencionCompletada(
      data.sessionId,
      jobId,
      ext as unknown as Record<string, unknown>,
      '',
    )

    // PR#3b: pest-alert delivery moved to EventHandler (pending_confirmation path).
    // entregarAlertaPlaga fires AFTER the farmer confirms and eventos_campo is inserted,
    // so event_id is available for the per-event idempotency guard (alerta_plaga_entregada_at).
    // This extraction-stage path never had an event_id — it has been removed entirely.
    // ALERT_DELIVERY_ENABLED now gates only the confirmation-point path (safe to flip).

    generation.end({
      output: { status: 'pending_confirmation', todas_completas },
      metadata: { tipo_evento: data.tipo_evento, confidence: ext.confidence_score },
    })

    consecutive429Count = 0

    if (todas_completas) {
      const completadasReales = intenciones.filter(i =>
        i.status === 'completed' &&
        !((i.evento_extraido as Record<string, unknown>)?.['_es_clarificacion']),
      )

      if (completadasReales.length > 0) {
        const sender = crearSenderWhatsApp()
        const { supabase } = await import('../integrations/supabase.js')

        const { data: lotesData } = await supabase
          .from('lotes')
          .select('lote_id, nombre_coloquial')
          .eq('finca_id', data.fincaId)
        const lotes = (lotesData ?? []) as Array<{ lote_id: string; nombre_coloquial: string }>

        const eventosExtraidos = completadasReales.map(i => i.evento_extraido as unknown as EventoCampoExtraido)

        // Poner sesión en pending_confirmation — EventHandler guarda cuando el agricultor dice "sí"
        await supabase
          .from('sesiones_activas')
          .update({
            status: 'pending_confirmation',
            clarification_count: 0,
            contexto_parcial: {
              extracted_data: eventosExtraidos,
              transcripcion_original: transaccion_original,
            },
          })
          .eq('session_id', data.sessionId)

        const feedback = buildFeedbackRecibo(eventosExtraidos, lotes)
        if (data.phone) {
          await sender.enviarTexto(data.phone, feedback).catch((err) => {
            console.error('[procesar-intencion] Error enviando feedback de confirmación:', err)
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

    const sender = crearSenderWhatsApp()

    if (isServerError) {
      console.error(`[procesar-intencion] 🛑 STOP — Server error en job ${jobId}: ${errMsg}`)
      await marcarIntencionFallida(data.sessionId, jobId, `server_error:${errMsg}`)
      if (data.phone) await sender.enviarTexto(data.phone, 'Tuve un problema técnico procesando tu reporte. Por favor intenta de nuevo en unos minutos. ⚠️').catch(sendErr => {
        console.warn('[pgBoss procesarIntencion] fallo al notificar server_error al usuario:', sendErr)
      })
      generation.end({ output: { status: 'server_error', error: errMsg }, level: 'ERROR' })
    } else {
      console.error(`[procesar-intencion] Error en job ${jobId}:`, err)
      await marcarIntencionFallida(data.sessionId, jobId, `error:${errMsg}`)
      if (data.phone) await sender.enviarTexto(data.phone, 'No pude extraer todos los datos de tu mensaje. Por favor revisa y envía un nuevo reporte. ⚠️').catch(sendErr => {
        console.warn('[pgBoss procesarIntencion] fallo al notificar error de extracción al usuario:', sendErr)
      })
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
  await boss.createQueue('sdr-chaser')
  await boss.createQueue('founder-manual-reply')

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

  // founder-crm PR5: fromMe events are enqueued (not handled inline on the
  // webhook path) to keep the ack fast (CR2). handleFounderManualReply is
  // best-effort by design and never throws, but the try/catch here is
  // defense-in-depth so a future change to that contract doesn't silently
  // kill this worker loop.
  await boss.work('founder-manual-reply', async (jobs) => {
    for (const job of jobs) {
      const { msg, traceId } = job.data as any
      console.log(`[pg-boss] founder-manual-reply job ${job.id} de ${msg?.from ?? '?'}`)
      try {
        await handleFounderManualReply(msg, traceId)
        console.log(`[pg-boss] founder-manual-reply job ${job.id} completado OK`)
      } catch (err) {
        console.error(`[pg-boss] founder-manual-reply job ${job.id} falló: ${String(err)}`)
        throw err
      }
    }
  })

  await boss.work('sdr-chaser', async (jobs) => {
    const { sdrChaserHandler } = await import('./sdrChaserWorker.js')
    for (const job of jobs) {
      try {
        await sdrChaserHandler(job as any)
      } catch (err) {
        console.error(`[pg-boss] sdr-chaser job ${job.id} falló:`, err)
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
        trace.event({ name: 'otp_whatsapp_sent', output: { phone: maskPhone(phone) } })
        console.log(`[pg-boss] OTP enviado por WhatsApp a ${maskPhone(phone)}`)
      } catch (err) {
        trace.event({ name: 'otp_whatsapp_failed', level: 'ERROR', output: { error: String(err), jobId: job.id } })
        console.error(`[pg-boss] Error enviando OTP a ${maskPhone(phone)}:`, err)
        throw err
      }
    }
  })

  const { registerCostAggregationWorker } = await import('./costAggregatorWorker.js')
  await registerCostAggregationWorker(boss)

  return boss
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss no inicializado')
  return boss
}

export function isPgBossReady(): boolean {
  return !!boss
}
