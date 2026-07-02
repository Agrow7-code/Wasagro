import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { getHandoffEstado, setHandoffEstado, saveSDRInteraccion, actualizarMensaje, updateSDRProspecto } from '../supabaseQueries.js'
import { detectarHandoffTrigger } from '../../agents/sdrAgent.js'
import { alertarFounder } from '../../integrations/whatsapp/founderAlerts.js'

// Copy for the graceful pause ack. CLAUDE.md voice rules: tuteo, ≤3 lines,
// only ✅/⚠️ emoji, none of the forbidden vocabulary.
const ACK_PAUSA = 'Ya avisé al equipo, en breve alguien te escribe directamente. ✅'

type HandoffTrace = ReturnType<typeof langfuse.trace>

/**
 * Runs a post-pause side-effect (interaction log, ack send, mark-processed)
 * without ever letting it throw out of handleHandoffGate. Once the conversation
 * is paused (or just got paused), a failure here must never fall through to the
 * caller's generic catch — that would send a bot auto-response to a paused
 * chat (P7). Failures are observable via a WARNING trace event instead.
 */
async function runPostPauseSideEffect(
  fn: () => Promise<void>,
  trace: HandoffTrace,
  prospectoId: string,
  step: string,
): Promise<void> {
  try {
    await fn()
  } catch (err) {
    trace.event({
      name: 'handoff_postpause_side_effect_failed',
      level: 'WARNING',
      input: { prospecto_id: prospectoId, step, error: String(err) },
    })
  }
}

/**
 * Pause/resume gate for the SDR (`!usuario`) branch of procesarMensajeEntrante
 * (design Decision 2). Must run BEFORE any FSM/LLM call (REQ-hand-008) and must
 * NEVER be reachable from the field-capture (`usuario`) path (REQ-hand-011).
 *
 * Returns true when the message was fully handled here (caller must short-circuit),
 * false when the caller should fall through to handleMeetingConfirmation/handleSDRSession.
 */
export async function handleHandoffGate(
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
): Promise<boolean> {
  const trace = langfuse.trace({ id: traceId, name: 'handoff_gate', tags: ['sdr', 'handoff'] })
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : '[mensaje de voz o imagen]'

  let estado: Record<string, unknown> | null
  try {
    estado = await getHandoffEstado(msg.from)
  } catch (err) {
    // Fail-closed (P7): a possibly-paused conversation must never get a bot
    // response. Rethrow so the caller's error handling takes over — nothing
    // was committed here, so the message correctly stays retryable as 'bot'.
    trace.event({ name: 'handoff_lookup_failed', level: 'ERROR', input: { phone: msg.from, error: String(err) } })
    throw err
  }
  if (!estado) {
    // First-turn message — no prospecto row yet. The gate is scoped to
    // "if a prospecto exists" (design Decision 2); let the normal SDR flow
    // create it.
    return false
  }

  const prospectoId = estado['id'] as string
  const turno = ((estado['turns_total'] as number | null) ?? 0) + 1

  if (estado['handoff_status'] === 'human_paused') {
    // Already paused: log only, no FSM/LLM, no auto-response. The founder ping
    // already happened at the bot→human_paused transition — do NOT re-ping here.
    // `turno` is intentionally frozen at the handoff turn for paused inbounds
    // (it is not recomputed/persisted per paused message); `sdr_interacciones
    // .created_at` is the canonical chronological order for the human reviewing
    // the thread. A distinct per-message turno is a deferred follow-up.
    await runPostPauseSideEffect(
      () =>
        saveSDRInteraccion({
          prospecto_id: prospectoId,
          phone: msg.from,
          turno,
          tipo: 'inbound',
          contenido: texto,
          action_taken: null,
          langfuse_trace_id: traceId,
        }),
      trace,
      prospectoId,
      'saveSDRInteraccion',
    )
    // BUG FIX (founder-crm inbox ordering): `GET /api/admin/conversaciones`
    // orders by `ultima_interaccion DESC`, but that column is only bumped by
    // `updateSDRProspecto`. While paused (exactly the conversations shown in
    // the founder inbox), new inbound messages were logged here but never
    // bumped `ultima_interaccion`, so the conversation went stale in the list.
    // `updateSDRProspecto(id, {})` always stamps `ultima_interaccion` even
    // with an empty updates payload — best-effort, wrapped like every other
    // post-pause side-effect (P7: must never throw out of the gate).
    await runPostPauseSideEffect(
      () => updateSDRProspecto(prospectoId, {}),
      trace,
      prospectoId,
      'updateSDRProspecto',
    )
    await runPostPauseSideEffect(
      () => actualizarMensaje(mensajeId, { status: 'processed' }),
      trace,
      prospectoId,
      'actualizarMensaje',
    )
    trace.event({ name: 'handoff_paused_message_logged', level: 'DEFAULT', input: { prospecto_id: prospectoId } })
    return true
  }

  // handoff_status === 'bot' — check for an auto-pause trigger.
  const trigger = detectarHandoffTrigger(texto, turno)

  if (trigger === 'human_request') {
    const now = new Date().toISOString()
    // DEFERRED (4R R1 WARNING): under >1 pg-boss replica, two jobs for the same
    // prospect could both read 'bot' and both auto-pause → duplicate ack/ping.
    // Not exploitable at single-replica (teamSize 1) today. Follow-up: make this
    // a conditional update (WHERE handoff_status='bot') and only ping/ack when
    // this call wins the transition. Tracked in sdd/founder-crm/apply-progress.
    try {
      await setHandoffEstado(prospectoId, {
        handoff_status: 'human_paused',
        handoff_reason: 'auto_human_request',
        handoff_paused_at: now,
        handoff_last_pinged_at: now,
      })
    } catch (err) {
      // Fail-closed (P7): the pause write did not commit, so nothing must be
      // pinged/acked/logged as if it had. Rethrow — the message stays 'bot'.
      trace.event({
        name: 'handoff_pause_write_failed',
        level: 'ERROR',
        input: { prospecto_id: prospectoId, error: String(err) },
      })
      throw err
    }
    // Notify the founder IMMEDIATELY after the pause write commits — it is the
    // whole point of the auto-pause. Nothing that can throw may sit between the
    // committed pause and this ping: if saveSDRInteraccion (or anything after)
    // threw first, the pause would already be committed but the founder would
    // never be pinged, and the next inbound would hit the already-paused branch
    // above, which does NOT re-ping — the notification would be lost forever.
    // alertarFounder itself swallows its own errors (never throws).
    await alertarFounder('sdr_handoff_solicitado', { phone: msg.from })

    // Everything past this point is best-effort logging/ack — a failure must
    // never fall through to the caller's generic bot-apology catch (P7).
    await runPostPauseSideEffect(
      () =>
        saveSDRInteraccion({
          prospecto_id: prospectoId,
          phone: msg.from,
          turno,
          tipo: 'inbound',
          contenido: texto,
          action_taken: null,
          langfuse_trace_id: traceId,
        }),
      trace,
      prospectoId,
      'saveSDRInteraccion',
    )
    // Same ultima_interaccion bump as the already-paused branch — the
    // auto-pause transition also logs an inbound that must move this
    // conversation to the top of the founder inbox list.
    await runPostPauseSideEffect(
      () => updateSDRProspecto(prospectoId, {}),
      trace,
      prospectoId,
      'updateSDRProspecto',
    )
    await runPostPauseSideEffect(() => sender.enviarTexto(msg.from, ACK_PAUSA), trace, prospectoId, 'enviarTexto')
    await runPostPauseSideEffect(
      () => actualizarMensaje(mensajeId, { status: 'processed' }),
      trace,
      prospectoId,
      'actualizarMensaje',
    )
    trace.event({ name: 'handoff_auto_paused', level: 'DEFAULT', input: { prospecto_id: prospectoId } })
    return true
  }

  // trigger is null or 'price_readiness' — price_readiness stays inert here
  // (design Decision 3); fall through to the normal SDR flow unchanged.
  return false
}
