import { z } from 'zod'
import { langfuse } from '../../integrations/langfuse.js'
import type { IWasagroLLM } from '../../integrations/llm/IWasagroLLM.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExtraccionSDRSchema } from '../../types/dominio/SDRTypes.js'
import { updateSDRProspecto, saveSDRInteraccion, actualizarMensaje } from '../../pipeline/supabaseQueries.js'
import { transcribirAudio } from '../../pipeline/sttService.js'
import { downloadEvolutionMedia } from '../../integrations/whatsapp/EvolutionMediaClient.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { getCachedContext, setCachedContext, setIfNotExists } from '../../integrations/redis.js'
import { reduceContext, computeFsmTransition, isMVPCultivo, type ConvContext, type Intent, type SDRFsmState } from './context.js'
import {
  loadHydratedContext,
  persistSessionState,
  computeLegacyUpdate,
  mapExtraccionToUpdate,
  buildContextoString,
} from './contextStore.js'
import { detectRoleFromText } from './roleDetector.js'
import { getClassifier, type IIntentClassifier } from './classifier.js'
import { compose, composeCalendarLink } from './composer.js'
import { TEMPLATES, resolveTemplate, type TemplateKey } from './skills/registry.js'
import { fsmStateToLegacySDRNode } from './contextStore.js'
import { validateMessage } from './validators.js'
import { scoreTerminalTransition } from './outcomeScoring.js'
import type { ILLMAdapter } from '../../integrations/llm/ILLMAdapter.js'
import type { BotAction } from './context.js'

const TEMPLATE_TO_BOT_ACTION: Record<TemplateKey, BotAction> = {
  closeOffer: 'sent_pitch',
  brochureSend: 'sent_brochure',
  calendarLink: 'sent_calendar_link',
  meetingConfirm: 'sent_meeting_confirmation',
  meetingWaiting: 'sent_meeting_waiting_ack',
  gracefulExit: 'sent_graceful_exit',
  willBookLater: 'sent_calendar_link',
  audioAck: 'none',
  outOfScopeCultivo: 'sent_calendar_link',
}

// Best-effort persistence. The contract: once the prospect has received the bot
// reply, no DB/Redis hiccup should poison the conversation by triggering the
// "Disculpá, tuve un problemita" recovery (real prod incident 2026-06-06: a
// stale CHECK constraint and a missing migration column made two consecutive
// UPDATEs throw, and the prospect saw the recovery twice and stopped replying).
// Failures are logged to console + LangFuse so the root cause is still visible.
export async function safePersist<T>(
  operation: () => Promise<T>,
  opts: { trace: ReturnType<typeof langfuse.trace>; eventName: string; meta: Record<string, unknown> },
): Promise<T | null> {
  try {
    return await operation()
  } catch (err) {
    const detail = {
      message: err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack?.slice(0, 1500) : undefined,
      code:    (err as { code?: string } | null)?.code,
      ...opts.meta,
    }
    console.error(`[SDR persist] ${opts.eventName} failed (non-fatal):`, detail)
    opts.trace.event({ name: opts.eventName, level: 'WARNING', input: detail })
    return null
  }
}

export interface SDRRouterContext {
  prospecto: Record<string, unknown>
  textoOriginal: string
  traceId: string
  llm: IWasagroLLM
  sender: IWhatsAppSender
  client?: SupabaseClient
  // Either an LLM adapter (router instantiates classifier) or a pre-built
  // classifier (tests inject a mock). Caller provides one of the two.
  adapter?: ILLMAdapter
  classifier?: IIntentClassifier
  // FIX-3: incoming WhatsApp message type. Lets the router fast-path audio
  // and image without invoking the text classifier on a placeholder string.
  mediaType?: 'texto' | 'audio' | 'imagen' | 'ubicacion' | 'documento' | 'otro'
  // SDR audio transcription: id of the mensajes_entrada row for this inbound
  // message. Used to best-effort persist the STT transcript to contenido_raw.
  mensajeId?: string
  // SDR audio transcription: raw audio ref/CDN URL + Evolution's original
  // webhook payload, needed to resolve audio bytes for STT (D4, mirrors
  // EventHandler.ts's field-capture audio path). Only relevant when
  // mediaType === 'audio'.
  audioUrl?: string
  mediaId?: string
  rawPayload?: unknown
}

const MAX_SDR_TURNS = 4

export async function routeSDRNode(rctx: SDRRouterContext): Promise<void> {
  const { prospecto, textoOriginal, traceId, llm, sender, client, adapter, classifier: injectedClassifier } = rctx
  const trace = langfuse.trace({ id: traceId })

  // Resolve the classifier: prefer an injected one (tests), otherwise build
  // from adapter via the module-level singleton. If neither is provided, the
  // router falls back to the Commit 2 behavior (placeholder intent='neutro').
  // Production wiring always passes adapter via procesarMensajeEntrante, so the
  // fallback is only for legacy tests that haven't been migrated.
  const classifier: IIntentClassifier | null = injectedClassifier
    ?? (adapter ? getClassifier(adapter) : null)

  // ── HYDRATE FIRST — must precede any classifier call (resuelve H1 ADR-009).
  //    All prospecto[...] accesses + the Redis session-state fetch live inside
  //    loadHydratedContext(). The router only reads from ctx + legacy from here.
  //    Redis-backed session state (intentHistory, lastBotMessage, etc.) is
  //    merged on top of the Supabase prospect row, so the classifier downstream
  //    actually sees what the bot said in the previous turn.
  const initial = await loadHydratedContext(prospecto)
  let ctx = initial.ctx
  const { sourceContext, statusActual } = initial.legacy

  // ── FIX-3: Audio short-circuit. ───────────────────────────────────────────
  //    STT (Deepgram, D4) lives in the field agent path, not here. An audio
  //    in SDR context is a strong interest signal — the prospect is showing
  //    they grasp the use case. Skip the text classifier (it would chew on a
  //    placeholder string and either crash or return garbage, then the catch
  //    in handleSDRSession would emit "tuve un problemita" — the bug the user
  //    reported on 2026-06-01). Force intent=interest, render the audioAck
  //    template, and run the same persist + send pipeline as the regular path.
  if (rctx.mediaType === 'audio') {
    await handleAudioInbound(rctx, ctx, initial)
    return
  }

  // ── 1. Global Fallback Check (Semantic Caching via Redis, no LLM) ─────────
  const cachedFallback = await getCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`)
  if (cachedFallback && ctx.fsmState !== 'triage') {
    await sender.enviarTexto(ctx.phone, cachedFallback)
    await saveSDRInteraccion({
      prospecto_id: ctx.prospectId,
      phone: ctx.phone,
      turno: ctx.turnCount + 1,
      tipo: 'inbound',
      contenido: textoOriginal,
      action_taken: 'global_fallback_answered',
      langfuse_trace_id: traceId,
    }, client)
    return
  }

  // Handle known off-topic fallback and cache it for future similar exact queries
  const isOffTopic = textoOriginal.toLowerCase().includes('funciona sin internet') || textoOriginal.toLowerCase().includes('precio')
  if (isOffTopic && ctx.fsmState !== 'triage') {
    if (textoOriginal.toLowerCase().includes('funciona sin internet')) {
      const fallbackResponse = 'Sí, Wasagro funciona completamente sin internet en la finca. Puedes enviar tus mensajes de WhatsApp y se sincronizarán cuando recuperes la señal.'
      await sender.enviarTexto(ctx.phone, fallbackResponse)
      await setCachedContext(`faq:${textoOriginal.toLowerCase().trim()}`, fallbackResponse, 86400 * 7)
      await saveSDRInteraccion({
        prospecto_id: ctx.prospectId,
        phone: ctx.phone,
        turno: ctx.turnCount + 1,
        tipo: 'inbound',
        contenido: textoOriginal,
        action_taken: 'global_fallback_answered',
        langfuse_trace_id: traceId,
      }, client)
      return
    }
  }

  // ── 2. Build contextoActual string from ConvContext ───────────────────────
  // Fase B replaces the legacy classifier methods with one that consumes
  // ConvContext directly. Until then, we pass the same info as a string so the
  // classifier at least sees lastBotMessage and intentHistory.
  const cachedSDRContext = await getCachedContext(ctx.phone)
  const contextoActual = buildContextoString(ctx, cachedSDRContext)

  // ── 3. Extraction (Fase B moves this to classifier.ts) ────────────────────
  let extraccionValidada: z.infer<typeof ExtraccionSDRSchema> | null = null
  let correctionLoopError = ''
  try {
    const rawExtraccion = await llm.extraerDatosSDR(textoOriginal, contextoActual, traceId)
    extraccionValidada = ExtraccionSDRSchema.parse(rawExtraccion)
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('[SDR Telemetry] Zod Validation Failed:', err.errors)
      trace.event({ name: 'sdr_extraction_zod_failure', level: 'WARNING', input: err.errors })
      correctionLoopError = `El modelo extrajo un formato inválido. Detalles: ${err.message}. Ignora la extracción y haz una pregunta aclaratoria.`
    }
  }

  // ── 4. Triage: spam shortcut (no further pipeline) ────────────────────────
  //    SEND first, PERSIST after (with tolerance) — same contract as the main
  //    flow. A persist failure must not block the reply nor trigger recovery.
  if (ctx.fsmState === 'triage' && extraccionValidada?.es_spam) {
    await sender.enviarTexto(ctx.phone, 'Soy el asistente de Wasagro, un sistema para operaciones agrícolas. Creo que te has equivocado de número. ¡Que tengas un buen día! 👋')
    const updateData: Record<string, unknown> = {
      turns_total: ctx.turnCount + 1,
      status: 'unqualified',
    }
    await safePersist(() => updateSDRProspecto(ctx.prospectId, updateData, client), {
      trace,
      eventName: 'sdr_update_failed',
      meta: { prospecto_id: ctx.prospectId, path: 'spam_shortcut' },
    })
    return
  }

  // ── 4b. Non-MVP cultivo: invitar a coordinar reunión (no rechazar) ────────
  //    Política CLAUDE.md §Identidad: "Si llega un cliente de otro país u otro
  //    cultivo, se trabaja con él. Nunca rechazar a un cliente por geografía o
  //    cultivo." Antes este branch mandaba "te anotamos para más adelante" y
  //    bajaba FSM a dormant — eso era rechazo de facto. Ahora reconocemos el
  //    cultivo, somos honestos sobre el foco actual, y mandamos el calendar
  //    link directo para coordinar una llamada de exploración.
  //
  //    Gate: solo dispara en estados tempranos (triage/discovery). Después de
  //    pitch_sent es tarde — el prospecto ya recibió pitch del producto MVP y
  //    cambiar la pista mid-funnel confunde.
  //
  //    Dedup TTL 24h: si el prospecto ya recibió el invite, no re-spammear.
  //    Después de mandado, FSM va a 'meeting_proposed' (no dormant) para que
  //    el chaser de booking (D24) trabaje y el flow siga vivo si el prospecto
  //    pregunta algo más antes de agendar.
  //
  //    "Confirmed wins" invariant: si ctx.cultivo ya era MVP y la extraction
  //    trae aguacate, effectiveCultivo sigue siendo el MVP y no entra acá.
  const extractedCultivo = extraccionValidada
    ? mapExtraccionToUpdate(extraccionValidada).cultivo ?? null
    : null
  const effectiveCultivo = ctx.cultivo ?? extractedCultivo
  const isEarlyFunnel = ctx.fsmState === 'triage' || ctx.fsmState === 'discovery'
  if (isEarlyFunnel && effectiveCultivo && !isMVPCultivo(effectiveCultivo)) {
    let dedupOk = true
    try {
      dedupOk = await setIfNotExists(`sdr_out_of_scope_sent:${ctx.phone}`, 86400)
    } catch (err) {
      console.warn('[SDR router] out-of-scope dedup setIfNotExists failed, sending anyway:', err)
    }
    if (dedupOk) {
      const respuesta = TEMPLATES.outOfScopeCultivo({ ctx: { ...ctx, cultivo: effectiveCultivo } })
      trace.event({
        name:  'sdr_non_mvp_cultivo_invite',
        level: 'DEFAULT',
        input: { phone: ctx.phone, prospecto_id: ctx.prospectId, cultivo: effectiveCultivo },
      })

      let nextCtx = reduceContext(ctx, {
        classification: { intent: 'interest', confidence: 1 },
        extraction:     extractedCultivo ? { cultivo: extractedCultivo } : {},
        botMessage:     respuesta,
        botAction:      'sent_calendar_link',
      })
      nextCtx = { ...nextCtx, fsmState: 'meeting_proposed' }

      // SEND first (invite + calendar link as two bubbles, same pattern as
      // the main close flow), PERSIST after with tolerance.
      await sender.enviarTexto(nextCtx.phone, respuesta)
      await sender.enviarTexto(nextCtx.phone, composeCalendarLink(nextCtx.prospectId))

      // Persist the bot's own invite reply as tipo='outbound' so it shows up
      // on Wasagro's side of the founder-crm thread (see getConversacionThread)
      // and so PR5's fromMe echo dedup recognizes our own send instead of
      // logging it as a founder manual reply. Best-effort — never breaks the flow.
      await safePersist(() => saveSDRInteraccion({
        prospecto_id: nextCtx.prospectId,
        phone: nextCtx.phone,
        turno: nextCtx.turnCount,
        tipo: 'outbound',
        contenido: respuesta,
        action_taken: null,
        langfuse_trace_id: traceId,
      }, client), {
        trace,
        eventName: 'sdr_outbound_interaccion_save_failed',
        meta: { prospecto_id: nextCtx.prospectId, path: 'non_mvp_cultivo_invite' },
      })

      const updateData = computeLegacyUpdate(nextCtx, initial)
      updateData['status'] = 'piloto_propuesto'
      updateData['calendar_link_sent_at'] = new Date().toISOString()
      await safePersist(() => updateSDRProspecto(nextCtx.prospectId, updateData, client), {
        trace,
        eventName: 'sdr_update_failed',
        meta: { prospecto_id: nextCtx.prospectId, fsmState: nextCtx.fsmState, path: 'non_mvp_cultivo_invite', updateKeys: Object.keys(updateData) },
      })
      await safePersist(() => saveSDRInteraccion({
        prospecto_id:      nextCtx.prospectId,
        phone:             nextCtx.phone,
        turno:             nextCtx.turnCount,
        tipo:              'inbound',
        contenido:         textoOriginal,
        action_taken:      fsmStateToLegacySDRNode(nextCtx.fsmState),
        langfuse_trace_id: traceId,
      }, client), {
        trace,
        eventName: 'sdr_interaccion_save_failed',
        meta: { prospecto_id: nextCtx.prospectId, path: 'non_mvp_cultivo_invite' },
      })
      await safePersist(() => persistSessionState(nextCtx), {
        trace,
        eventName: 'sdr_session_persist_failed',
        meta: { prospecto_id: nextCtx.prospectId, path: 'non_mvp_cultivo_invite' },
      })

      // D24: booking reminder 24h. Mismo job que el close flow normal. El
      // chaser verifica calcom_booking_id antes de enviar — si el prospecto
      // ya agendó, no nag.
      try {
        const { getBoss, isPgBossReady } = await import('../../workers/pgBoss.js')
        if (isPgBossReady()) {
          const boss = getBoss()
          await boss.send('sdr-chaser', {
            prospecto_id:  nextCtx.prospectId,
            expected_turn: nextCtx.turnCount,
            reminder_type: 'booking',
          }, { startAfter: 24 * 3600 })
        }
      } catch (bossErr) {
        console.warn('[SDR] No se pudo encolar booking reminder (non-MVP invite):', bossErr)
      }
      return
    }
  }

  // ── 5. Classify intent (Fase B: typed enum + retry-with-feedback) ────────
  //    The classifier reads ConvContext directly (lastBotMessage,
  //    intentHistory, fsmState, lastBotAction). H1 of ADR-009 is now resolved
  //    at the wiring level: 'Ya?' tras pitch -> advance, no objection.
  //    Fallback to placeholder when no classifier was wired (legacy tests).
  const classification = classifier
    ? await classifier.classify(textoOriginal, ctx, traceId)
    : { intent: 'neutro' as Intent, confidence: 0 }
  const turnIntent: Intent = classification.intent

  // ── 6. FSM transitions ────────────────────────────────────────────────────
  //    Dry-run the same pure transition function the reducer uses, so the
  //    composer + directive builder downstream see the SAME nextFsmState the
  //    state will land at after reduceContext(). Without this, e.g.
  //    pitch_sent + advance left nextFsmState='pitch_sent' here while the
  //    reducer correctly transitioned to 'closing' — composer didn't resolve
  //    a template (no key for pitch_sent) and the response fell back to the
  //    LLM with the pitch directive, sending the pitch AGAIN on a 'Ya?'. The
  //    E2E test in handleSDRSession.roundtrip.test.ts catches that exact bug.
  let nextFsmState: SDRFsmState = computeFsmTransition(ctx.fsmState, turnIntent)
  const nuevoTurno = ctx.turnCount + 1

  // Discovery -> pitch_sent is the only transition the reducer doesn't own:
  // it depends on accumulated data, not on intent. Override here when the
  // transition function leaves us in 'discovery' but the data gate is met.
  if (nextFsmState === 'discovery') {
    const hitMaxTurns = nuevoTurno >= MAX_SDR_TURNS && ctx.datosConocidos >= 2
    if (ctx.datosConocidos >= 3 || hitMaxTurns) {
      nextFsmState = 'pitch_sent'
    }
  }

  // ── 7. Plan directive (reads from ctx, not prospecto) ─────────────────────
  //    Note: at this point nextFsmState is the FSM-decided next state but the
  //    reducer hasn't run yet. The directive uses nextFsmState because the
  //    composer needs to know which message to produce for this turn.
  let directiva = ''
  let requires_founder_approval = false
  const ctwaContext = sourceContext ? ` [NOTA: El cliente llegó desde el anuncio: ${sourceContext}. Usa esto para personalizar tu saludo o enfoque].` : ''

  if (nextFsmState === 'discovery') {
    if (correctionLoopError) {
      directiva = `${correctionLoopError} Pregunta de nuevo de forma natural. MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.fincasEstimadas == null) {
      directiva = `Haz una pregunta corta sobre cuántas hectáreas o fincas administran actualmente.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.cultivo == null) {
      directiva = `Haz una pregunta corta sobre qué tipo de cultivo principal tienen.${ctwaContext} MÁXIMO 3 oraciones o 90 palabras.`
    } else if (ctx.pais == null) {
      directiva = 'Pregunta en qué país está ubicada su finca. MÁXIMO 3 oraciones o 90 palabras.'
    } else if (ctx.sistemaActual == null) {
      directiva = 'Pregunta cómo registran actualmente las labores o aplicaciones de insumos (ej. papel, Excel). MÁXIMO 3 oraciones o 90 palabras.'
    }
  } else if (nextFsmState === 'pitch_sent') {
    // Pitch body uses the prospect's already-extracted cultivo/sistema for personalization.
    // Some of these may be null if the FSM hit MAX_SDR_TURNS without all data — the prompt
    // is designed to gracefully handle missing slots ("tu cultivo" instead of explicit name).
    const cultivoLabel = ctx.cultivo ?? 'tu cultivo'
    const sistemaLabel = ctx.sistemaActual ?? 'el método actual'
    const fincasLabel = ctx.fincasEstimadas ?? 'tus'
    directiva = `Usa los datos recopilados para redactar un argumento persuasivo que genere un "aha moment". En lugar de solo describir funciones, enfócate en el problema de usar ${sistemaLabel} y cómo Wasagro les ahorrará horas de trabajo en sus ${fincasLabel} hectáreas/fincas de ${cultivoLabel}, evitando pérdidas con alertas tempranas y tableros automáticos por WhatsApp.

ESTRICTO:
- NO pidas agendar la demo en este mensaje (eso lo hace el siguiente turno).
- SÍ termina obligatoriamente con UNA pregunta corta de validación que invite al cliente a responder. Nunca cierres con un párrafo explicativo "en aire" — el cliente se queda sin saber qué responder y se va. Ejemplos válidos: "¿Te hace sentido para tu finca?" / "¿Esto te suena con lo que vivís?" / "¿Cómo registran hoy lo que pasa en el lote?" / "¿Querés que te muestre cómo se vería con tus aguacates?"
- La pregunta NO es agendar la demo — es validar interés o profundizar el dolor.
- MÁXIMO 3 oraciones y 90 palabras en total (la pregunta cuenta como una oración).`
  } else if (nextFsmState === 'closing') {
    requires_founder_approval = true
    // directiva remains empty — closing is a deterministic template now (Fase A).
    // The LLM is not asked to redact this turn; compose() resolves the template
    // below. Keeping requires_founder_approval flag so persistence + telemetry
    // continue to fire.
  }

  // Fase A: structural messages come from deterministic templates, not LLM.
  // Today only the 'closing' state has a template resolution from this branch
  // (post-pitch states are handled in sdrAgent.handleMeetingConfirmation).
  // Discovery questions and pitch body still need LLM creativity, so they fall
  // through to redactarMensajeSDR.
  let respuesta: string
  const composed = compose(nextFsmState, turnIntent, ctx)
  if (composed) {
    respuesta = composed.text
    trace.event({
      name: 'sdr_template_used',
      level: 'DEFAULT',
      input: { templateKey: composed.templateKey, state: nextFsmState, intent: turnIntent },
    })
  } else if (nextFsmState === 'meeting_confirmed') {
    // Post-meeting safety net: if the FSM is in meeting_confirmed but no
    // template matched (e.g. intent=consulta or neutro after booking),
    // NEVER fall through to the LLM — it would re-pitch or re-send the
    // calendar link. Acknowledge and hold.
    respuesta = '¡Perfecto! Un miembro del equipo se te une enseguida. Cualquier duda me avisas por acá. ✅'
    trace.event({
      name: 'sdr_template_used',
      level: 'DEFAULT',
      input: { templateKey: 'meetingWaiting_fallback', state: nextFsmState, intent: turnIntent },
    })
  } else {
    // LLM-generated text. Fase D validators run AFTER the LLM redacts and
    // BEFORE we cache/send. Templates skip validators on purpose: they're
    // already vetted deterministic strings. The LLM is the only path that
    // drifts (missing CTA, false promises, unnecessary apologies).
    const raw = await llm.redactarMensajeSDR(textoOriginal, contextoActual, directiva, traceId)
    respuesta = validateMessage(raw, ctx, traceId)
  }

  // Cache recent response in Dual-Tier Memory
  await setCachedContext(ctx.phone, respuesta, 3600 * 24)

  // ── 8. REDUCE: single, atomic context update for this turn ────────────────
  //    Uses the REAL intent from the classifier (not the 'neutro' placeholder
  //    of Commit 2). The reducer's FSM transition table now does most of the
  //    work — pitch_sent + advance -> closing, closing + wants_brochure ->
  //    brochure_sent, any + declined -> declined, etc. The only override we
  //    keep is discovery -> pitch_sent, which is a data-driven gate (router
  //    knows when there are enough facts to pitch).
  const extraction = extraccionValidada ? mapExtraccionToUpdate(extraccionValidada) : {}

  // Role detection from free text — runs every turn, but the reducer only
  // upgrades segmento from 'desconocido', so once set it sticks. This prevents
  // the regression where size (e.g. "30 hectáreas") was misread as exportadora
  // when the prospect explicitly said "tengo mi propia finca".
  const roleHit = detectRoleFromText(textoOriginal)
  if (roleHit) {
    extraction.segmento = roleHit.segmento
    trace.event({
      name: 'sdr_role_detected',
      level: 'DEFAULT',
      input: { segmento: roleHit.segmento, reason: roleHit.reason, pattern: roleHit.matchedPattern },
    })
  }

  const reduceInput: Parameters<typeof reduceContext>[1] = {
    classification: { intent: turnIntent, confidence: classification.confidence },
    extraction,
    botMessage: respuesta,
  }
  if (composed) reduceInput.botAction = TEMPLATE_TO_BOT_ACTION[composed.templateKey]

  ctx = reduceContext(ctx, reduceInput)

  // Discovery -> pitch_sent is the only transition the reducer doesn't own:
  // it depends on accumulated data, not on intent. Stamp it here.
  if (nextFsmState === 'pitch_sent' && ctx.fsmState === 'discovery') {
    ctx = { ...ctx, fsmState: 'pitch_sent' }
  }

  // SDR funnel scoring: when the FSM lands on a terminal state (meeting_confirmed,
  // declined, dormant), emit a numeric score to LangFuse so conversion-rate
  // widgets can group by model/prompt-version/narrativa. Idempotent: only fires
  // when the previous state was different.
  scoreTerminalTransition(trace, initial.ctx.fsmState, ctx.fsmState, {
    prospectoId: ctx.prospectId,
    phone:       ctx.phone,
    narrativa:   (prospecto['narrativa_asignada'] as string | null) ?? null,
    cultivo:     ctx.cultivo,
    segmento:    ctx.segmento,
    turnCount:   ctx.turnCount,
    source:      'router',
  })

  // ── 8. SEND first, PERSIST after (with tolerance) ─────────────────────────
  // Order matters: the prospect must receive their reply even if DB persistence
  // fails. A failed UPDATE/INSERT used to throw all the way up to handleSDRSession,
  // which sent the "Disculpá, tuve un problemita" recovery — UX-killing.
  // Now: brochure dedup → send → safePersist(update + interaccion + redis).

  // Brochure dedup guard: at most one brochure send per phone per 30s. Stays
  // BEFORE the send because it gates the send itself.
  let shouldSend = true
  if (composed?.templateKey === 'brochureSend') {
    try {
      const dedupOk = await setIfNotExists(`sdr_brochure_sent:${ctx.phone}`, 30)
      if (!dedupOk) {
        shouldSend = false
        trace.event({
          name:  'sdr_brochure_dedup_skipped',
          level: 'WARNING',
          input: { phone: ctx.phone, prospecto_id: ctx.prospectId },
        })
      }
    } catch (err) {
      console.warn('[SDR router] brochure dedup setIfNotExists failed, sending anyway:', err)
    }
  }

  // Send the reply FIRST. If the send itself fails, the throw propagates to
  // handleSDRSession's catch — which is correct (the prospect didn't get a
  // reply, recovery message is appropriate).
  if (shouldSend) {
    await sender.enviarTexto(ctx.phone, respuesta)
  }
  if (requires_founder_approval) {
    await sender.enviarTexto(ctx.phone, composeCalendarLink(ctx.prospectId))
    trace.event({ name: 'sdr_pilot_proposed', input: { prospecto_id: ctx.prospectId } })
  }

  // From here down: everything is best-effort. The prospect already has their
  // reply; a stale CHECK constraint or missing column must NOT trigger recovery.

  // Persist the bot's own reply as tipo='outbound' so it shows up on Wasagro's
  // side of the founder-crm thread (see getConversacionThread) and so PR5's
  // fromMe echo dedup recognizes our own send instead of logging it as a
  // founder manual reply. Best-effort — never breaks the flow.
  if (shouldSend) {
    await safePersist(() => saveSDRInteraccion({
      prospecto_id: ctx.prospectId,
      phone: ctx.phone,
      turno: ctx.turnCount,
      tipo: 'outbound',
      contenido: respuesta,
      action_taken: null,
      langfuse_trace_id: traceId,
    }, client), {
      trace,
      eventName: 'sdr_outbound_interaccion_save_failed',
      meta: { prospecto_id: ctx.prospectId, turno: ctx.turnCount },
    })
  }

  const updateData = computeLegacyUpdate(ctx, initial)
  if (requires_founder_approval) {
    updateData.status = 'piloto_propuesto'
    updateData.founder_notified_at = new Date().toISOString()
    updateData.calendar_link_sent_at = new Date().toISOString()
    updateData.deal_brief = {
      draft_message: respuesta,
      fincas_en_cartera: ctx.fincasEstimadas,
      cultivo_principal: ctx.cultivo,
      pais: ctx.pais,
      sistema_actual: ctx.sistemaActual,
      segmento_icp: ctx.segmento,
    }
  } else if (nextFsmState === 'discovery' && statusActual === 'new') {
    updateData.status = 'en_discovery'
  }

  await safePersist(() => updateSDRProspecto(ctx.prospectId, updateData, client), {
    trace,
    eventName: 'sdr_update_failed',
    meta: { prospecto_id: ctx.prospectId, fsmState: ctx.fsmState, updateKeys: Object.keys(updateData) },
  })

  await safePersist(() => saveSDRInteraccion({
    prospecto_id: ctx.prospectId,
    phone: ctx.phone,
    turno: ctx.turnCount,
    tipo: 'inbound',
    contenido: textoOriginal,
    // The sdr_interacciones.action_taken CHECK constraint (migration 32) only
    // accepts legacy SDRNode values. fsmStateToLegacySDRNode collapses the new
    // enum back to the legal legacy form.
    action_taken: fsmStateToLegacySDRNode(nextFsmState),
    langfuse_trace_id: traceId,
  }, client), {
    trace,
    eventName: 'sdr_interaccion_save_failed',
    meta: { prospecto_id: ctx.prospectId, turno: ctx.turnCount },
  })

  await safePersist(() => persistSessionState(ctx), {
    trace,
    eventName: 'sdr_session_persist_failed',
    meta: { prospecto_id: ctx.prospectId, fsmState: ctx.fsmState },
  })

  // D24: Enqueue booking reminder (24h) when calendar link was sent
  if (requires_founder_approval) {
    try {
      const { getBoss, isPgBossReady } = await import('../../workers/pgBoss.js')
      if (isPgBossReady()) {
        const boss = getBoss()
        await boss.send('sdr-chaser', {
          prospecto_id: ctx.prospectId,
          expected_turn: ctx.turnCount,
          reminder_type: 'booking',
        }, { startAfter: 24 * 3600 })
      }
    } catch (bossErr) {
      console.warn('[SDR] No se pudo encolar booking reminder:', bossErr)
    }
  }
}

// ─── Audio inbound handler (FIX-3, extended with STT — SDR audio transcription) ─
// Pulled out so the audio path doesn't share scope with the long routeSDRNode
// body — separation of concerns + easier to unit-test.
//
// SDR audio transcription: reuses D4 Deepgram STT (the same transcribirAudio
// the field pipeline calls in EventHandler.ts) so the bot actually understands
// what the prospect said, instead of always synthesizing a fixed
// intent='interest' classification. When transcription succeeds, the
// transcript is routed through the exact same text pipeline (classify ->
// extract -> FSM -> reply) as a typed message — routeSDRNode is called again
// with mediaType='texto' so it does NOT re-enter this audio branch. When
// transcription fails or comes back empty, this degrades to the ORIGINAL
// FIX-3 behavior (synthesized interest + audioAck template) so the flow never
// breaks (P4).
//
// FIX 1 (R4): sends an interim ack BEFORE STT+LLM so the prospect gets a
// <5s response (P3) instead of silence during transcription. Mirrors
// EventHandler.ts's field-capture audio path. This is IN ADDITION to the
// eventual real reply (transcript pipeline reply, or the audioAck fallback)
// — never a replacement.
//
// FIX 2 (R3): sdr_audio_received now fires unconditionally on every audio
// inbound turn (documented dashboard signal, docs/LANGFUSE-PLAYBOOK.md,
// audio->close conversion) instead of only on the fallback branch, so
// successful transcriptions aren't undercounted. sdr_audio_transcribed is an
// ADDITIONAL signal on the success path only.
async function handleAudioInbound(
  rctx: SDRRouterContext,
  ctxIn: ConvContext,
  initial: Awaited<ReturnType<typeof loadHydratedContext>>,
): Promise<void> {
  const { traceId, sender, client, mensajeId } = rctx
  const trace = langfuse.trace({ id: traceId })

  // FIX 1 (R4): interim ack, best-effort — a send failure here must never
  // block transcription.
  try {
    await sender.enviarTexto(ctxIn.phone, '✅ Recibí tu audio, dame un momento y te respondo.')
  } catch (err) {
    trace.event({
      name:  'sdr_audio_interim_ack_failed',
      level: 'WARNING',
      input: { error: err instanceof Error ? err.message : String(err) },
    })
  }

  // FIX 2 (R3): emit the documented signal on every audio turn, regardless
  // of whether STT below succeeds.
  trace.event({
    name:  'sdr_audio_received',
    level: 'DEFAULT',
    input: { fsmStateBefore: ctxIn.fsmState, datosConocidos: ctxIn.datosConocidos },
  })

  let transcripcion = ''
  try {
    const audioInput = await resolveSDRAudioInput(rctx)
    transcripcion = await transcribirAudio(audioInput, traceId)
  } catch (err) {
    trace.event({
      name:  'sdr_audio_transcription_failed',
      level: 'WARNING',
      input: { error: err instanceof Error ? err.message : String(err) },
    })
  }

  if (transcripcion.trim()) {
    // Best-effort: surface what the prospect actually said in the thread
    // (mensajes_entrada.contenido_raw) instead of only the raw audio ref.
    if (mensajeId) {
      await safePersist(() => actualizarMensaje(mensajeId, { contenido_raw: transcripcion }, client), {
        trace,
        eventName: 'sdr_audio_transcript_persist_failed',
        meta: { mensajeId },
      })
    }

    trace.event({
      name:  'sdr_audio_transcribed',
      level: 'DEFAULT',
      input: { fsmStateBefore: ctxIn.fsmState, transcriptLength: transcripcion.length },
    })

    // Route the transcript through the SAME text pipeline as a typed message.
    // mediaType='texto' is required so routeSDRNode does not re-enter this
    // audio branch (avoids infinite recursion).
    await routeSDRNode({ ...rctx, mediaType: 'texto', textoOriginal: transcripcion })
    return
  }

  // ── Fallback: STT failed or returned empty — ORIGINAL FIX-3 behavior ──────
  // (synthesized interest + audioAck template) so the flow never breaks (P4).

  // The classifier never runs on this fallback path — we synthesize the
  // classification directly. Confidence 0.85 mirrors the original FIX-3
  // rationale: audio in SDR context is a strong but not certain signal of
  // interest (it could also be a misclick).
  const classification = { intent: 'interest' as Intent, confidence: 0.85 }
  const respuesta = TEMPLATES.audioAck({ ctx: ctxIn })

  // Reduce with the synthesized intent. FSM transitions follow the same
  // table as text: pitch_sent + interest -> closing, etc.
  const ctx = reduceContext(ctxIn, {
    classification,
    extraction: {},
    botMessage: respuesta,
  })

  // SDR funnel scoring — same contract as the text path.
  scoreTerminalTransition(trace, ctxIn.fsmState, ctx.fsmState, {
    prospectoId: ctx.prospectId,
    phone:       ctx.phone,
    narrativa:   (rctx.prospecto['narrativa_asignada'] as string | null) ?? null,
    cultivo:     ctx.cultivo,
    segmento:    ctx.segmento,
    turnCount:   ctx.turnCount,
    source:      'router',
  })

  // FIX 2: sdr_audio_received already fired unconditionally near the top of
  // handleAudioInbound — no duplicate emission here.

  // SEND first, PERSIST after (with tolerance) — same contract as the text
  // path. A failed UPDATE/INSERT must NOT stop the prospect from getting the
  // audio acknowledgement.
  await sender.enviarTexto(ctx.phone, respuesta)

  const updateData = computeLegacyUpdate(ctx, initial)
  await safePersist(() => updateSDRProspecto(ctx.prospectId, updateData, client), {
    trace,
    eventName: 'sdr_update_failed',
    meta: { prospecto_id: ctx.prospectId, fsmState: ctx.fsmState, path: 'audio', updateKeys: Object.keys(updateData) },
  })

  await safePersist(() => saveSDRInteraccion({
    prospecto_id: ctx.prospectId,
    phone: ctx.phone,
    turno: ctx.turnCount,
    tipo: 'inbound',
    contenido: '[audio]',
    action_taken: fsmStateToLegacySDRNode(ctx.fsmState),
    langfuse_trace_id: traceId,
  }, client), {
    trace,
    eventName: 'sdr_interaccion_save_failed',
    meta: { prospecto_id: ctx.prospectId, turno: ctx.turnCount, path: 'audio' },
  })

  await safePersist(() => persistSessionState(ctx), {
    trace,
    eventName: 'sdr_session_persist_failed',
    meta: { prospecto_id: ctx.prospectId, fsmState: ctx.fsmState, path: 'audio' },
  })
}

// Resolves the audio bytes for STT — same pattern as EventHandler.ts's
// field-capture audio path (D8): download via Evolution's base64 endpoint
// (the CDN media URL requires Bearer auth Evolution already holds and is
// never usable directly — D8: it always 401s). Never throws — a resolution
// failure just means transcribirAudio gets an empty input and the caller's
// try/catch degrades to the audioAck fallback (P4).
//
// FIX 3 (R3): does NOT fall back to the raw audioUrl/mediaId (the WhatsApp/
// Evolution CDN URL). D8 established that URL always 401s, so attempting
// STT on it is doomed. When the Evolution download path is unavailable
// (missing env/payload) or the download itself fails, this resolves to ''
// so handleAudioInbound cleanly degrades to the audioAck fallback instead of
// wasting a guaranteed-to-fail fetch.
async function resolveSDRAudioInput(rctx: SDRRouterContext): Promise<string | Buffer> {
  const evApiUrl = process.env['EVOLUTION_API_URL']
  const evApiKey = process.env['EVOLUTION_API_KEY']
  const evInstance = process.env['EVOLUTION_INSTANCE']

  if (evApiUrl && evApiKey && evInstance && rctx.rawPayload !== undefined) {
    try {
      const media = await downloadEvolutionMedia(rctx.rawPayload, evApiUrl, evApiKey, evInstance)
      return Buffer.from(media.base64, 'base64')
    } catch (err) {
      langfuse.trace({ id: rctx.traceId }).event({
        name:  'sdr_audio_download_failed',
        level: 'WARNING',
        input: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  return ''
}
