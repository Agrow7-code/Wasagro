// Sent when the prospect says they're in/awaiting the scheduled meeting
// (intent = 'meeting_waiting'). The ONLY acceptable response here is a
// warm acknowledgment — never resend the calendar link, never re-offer
// the brochure, never ask "¿cuándo tienes 30 minutos?". The prospect is
// already past the funnel; this template prevents the bot from
// regressing and re-sending stale CTAs (the bug reported 2026-06-02
// where "ya estoy en la reunión esperando que me acepten" triggered the
// calendar link again).

export function meetingWaiting(_: { ctx?: unknown; vars?: unknown }): string {
  return '¡Perfecto! Un miembro del equipo se te une enseguida. Cualquier duda me avisas por acá. ✅'
}
