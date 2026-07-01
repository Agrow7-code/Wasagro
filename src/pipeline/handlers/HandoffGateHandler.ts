import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../../integrations/whatsapp/IWhatsAppSender.js'
import { getHandoffEstado, setHandoffEstado, saveSDRInteraccion, actualizarMensaje } from '../supabaseQueries.js'
import { detectarHandoffTrigger } from '../../agents/sdrAgent.js'
import { alertarFounder } from '../../integrations/whatsapp/founderAlerts.js'

// Copy for the graceful pause ack. CLAUDE.md voice rules: tuteo, ≤3 lines,
// only ✅/⚠️ emoji, none of the forbidden vocabulary.
const ACK_PAUSA = 'Ya avisé al equipo, en breve alguien te escribe directamente. ✅'

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

  const estado = await getHandoffEstado(msg.from)
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
    await saveSDRInteraccion({
      prospecto_id: prospectoId,
      phone: msg.from,
      turno,
      tipo: 'inbound',
      contenido: texto,
      action_taken: null,
      langfuse_trace_id: traceId,
    })
    await actualizarMensaje(mensajeId, { status: 'processed' })
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
    await setHandoffEstado(prospectoId, {
      handoff_status: 'human_paused',
      handoff_reason: 'auto_human_request',
      handoff_paused_at: now,
      handoff_last_pinged_at: now,
    })
    await saveSDRInteraccion({
      prospecto_id: prospectoId,
      phone: msg.from,
      turno,
      tipo: 'inbound',
      contenido: texto,
      action_taken: null,
      langfuse_trace_id: traceId,
    })
    // Notify the founder FIRST — it is the whole point of the auto-pause, and
    // alertarFounder swallows its own errors. The prospect ack is best-effort:
    // if the send throws it must NOT skip the founder ping or leave the message
    // unprocessed (a retry would hit the already-paused branch, which does not
    // ping — the notification would be lost silently). P4: log the ack failure.
    await alertarFounder('sdr_handoff_solicitado', { phone: msg.from })
    try {
      await sender.enviarTexto(msg.from, ACK_PAUSA)
    } catch (err) {
      trace.event({
        name: 'handoff_ack_send_failed',
        level: 'WARNING',
        input: { prospecto_id: prospectoId, error: String(err) },
      })
    }
    await actualizarMensaje(mensajeId, { status: 'processed' })
    trace.event({ name: 'handoff_auto_paused', level: 'DEFAULT', input: { prospecto_id: prospectoId } })
    return true
  }

  // trigger is null or 'price_readiness' — price_readiness stays inert here
  // (design Decision 3); fall through to the normal SDR flow unchanged.
  return false
}
