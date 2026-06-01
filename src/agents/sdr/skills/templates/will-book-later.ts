// Sent when the prospect says they'll book later (intent = 'will_book_later').
// Acknowledges + reminds the link is on file, no nagging. The sdr-chaser job
// (20h delay) will re-engage if they don't come back.

export function willBookLater(_: { ctx?: unknown; vars?: unknown }): string {
  return '¡Perfecto, quedo a la espera! Cuando tengas un ratito, me avisas o usas el link que te mandé. ⏰'
}
