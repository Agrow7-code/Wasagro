// The calendar link is sent as a follow-up message right after the close
// offer, when the FSM is in 'closing' and requires founder approval / link
// delivery. Kept as a separate message (not concatenated to closeOffer) to
// match the existing UX where the link appears as a discrete bubble.
//
// Signature matches TemplateRenderer for registry uniformity even though
// this template does not consume ctx.

export function calendarLink(_: { ctx?: unknown; vars?: unknown }): string {
  const url = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
  return url
    ? `📅 Puedes elegir el horario aquí: ${url}`
    : '¿Qué día y hora te queda mejor la próxima semana? 📅'
}
