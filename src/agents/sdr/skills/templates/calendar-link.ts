// The calendar link is sent as a follow-up message right after the close
// offer, when the FSM is in 'closing' and requires founder approval / link
// delivery. Kept as a separate message (not concatenated to closeOffer) to
// match the existing UX where the link appears as a discrete bubble.
//
// Signature matches TemplateRenderer for registry uniformity even though
// this template does not consume ctx.
//
// When prospecto_id is provided, it's appended as a query param so Cal.com
// preserves it in payload.metadata on the webhook — enabling 100% reliable
// prospect-to-booking matching without depending on phone/email lookup.

export function calendarLink(input: { ctx?: unknown; vars?: Record<string, unknown> }): string {
  const url = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
  if (!url) return '¿Qué día y hora te queda mejor la próxima semana? 📅'

  const prospectoId = input.vars?.['prospecto_id'] as string | undefined
  const fullUrl = prospectoId ? `${url}?prospecto_id=${encodeURIComponent(prospectoId)}` : url
  return `📅 Puedes elegir el horario aquí: ${fullUrl}`
}
