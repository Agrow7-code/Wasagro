import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import { getSDRProspecto, getRecentOutboundInteracciones, saveSDRInteraccion, updateSDRProspecto } from '../supabaseQueries.js'

// Window to treat an inbound fromMe event as an echo of our OWN outbound send
// (bot auto-response, panel send, chaser, booking confirmation) rather than a
// genuine founder-typed manual reply. Evolution's fromMe webhook for our own
// API-sent messages typically lands within a couple seconds; 120s gives ample
// margin without risking a false-negative echo match against a real reply the
// founder happens to type minutes later.
const DEDUP_WINDOW_MS = 120_000

function extraerTexto(msg: NormalizedMessage): string {
  return msg.tipo === 'texto' ? (msg.texto ?? '') : '[mensaje de voz o imagen]'
}

/**
 * Reconciles a founder-typed WhatsApp reply — sent from the founder's own
 * linked device and observed as an Evolution `fromMe` webhook event — into
 * the SDR conversation thread (founder-crm PR5, slice 5).
 *
 * SAFETY INVARIANTS:
 * - Runs ONLY from the webhook path (src/webhook/router.ts), for messages
 *   already tagged esFromMe=true by EvolutionAdapter. It must NEVER be
 *   reachable from procesarMensajeEntrante/handleEvento — this function does
 *   not call into either.
 * - If no `sdr_prospecto` exists for the recipient phone, this is a
 *   farmer/field message or an unknown number — IGNORE, never create
 *   anything (field-capture pipeline safety, P1).
 * - Best-effort (P4: log, never throw): any failure here must never bubble
 *   out and break the webhook's 200 response.
 * - Does NOT touch `handoff_status` — a manual reply typed on the phone is
 *   not a formal pause/resume action (that stays the admin panel's job).
 */
export async function handleFounderManualReply(msg: NormalizedMessage, traceId?: string): Promise<void> {
  const trace = traceId ? langfuse.trace({ id: traceId, name: 'founder_manual_reply' }) : null

  try {
    const prospecto = await getSDRProspecto(msg.from)
    if (!prospecto) {
      // No SDR conversation for this recipient — could be a farmer/field
      // number or an unrelated chat. Never create anything here.
      trace?.event({ name: 'founder_manual_reply_no_prospecto', level: 'DEFAULT', input: { phone: msg.from } })
      return
    }

    const prospectoId = prospecto['id'] as string
    const texto = extraerTexto(msg)

    // Dedup against our own sends: the bot AND the admin panel send via
    // Evolution's API, which ALSO emits a fromMe echo for the message we just
    // sent. Without this check, every automated/panel send would be
    // double-logged as a "founder manual reply".
    const sinceIso = new Date(msg.timestamp.getTime() - DEDUP_WINDOW_MS).toISOString()
    const recientes = await getRecentOutboundInteracciones(prospectoId, sinceIso)
    const esEco = recientes.some((row) => String(row['contenido'] ?? '').trim() === texto.trim())
    if (esEco) {
      trace?.event({ name: 'founder_manual_reply_echo_skipped', level: 'DEFAULT', input: { prospecto_id: prospectoId } })
      return
    }

    await saveSDRInteraccion({
      prospecto_id: prospectoId,
      phone: msg.from,
      turno: (prospecto['turns_total'] as number | null) ?? 0,
      tipo: 'founder_override',
      contenido: texto,
      action_taken: null,
      langfuse_trace_id: traceId,
    })
    // Bump ultima_interaccion so this conversation surfaces correctly ordered
    // in the founder inbox (same pattern as HandoffGateHandler's paused/
    // auto-pause branches — updateSDRProspecto(id, {}) always stamps it).
    await updateSDRProspecto(prospectoId, {})

    trace?.event({ name: 'founder_manual_reply_logged', level: 'DEFAULT', input: { prospecto_id: prospectoId } })
  } catch (err) {
    console.error('[FounderManualReplyHandler] error procesando fromMe:', err)
    trace?.event({ name: 'founder_manual_reply_error', level: 'ERROR', input: { error: String(err) } })
  }
}
