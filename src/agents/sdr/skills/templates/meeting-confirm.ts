// Sent when the prospect explicitly accepts a meeting (intent = 'booked').
// Short, warm, sets expectation about a reminder. No follow-up question
// because the closure is the entire point — adding "¿algo más?" here would
// re-open the conversation right when it just landed.

export function meetingConfirm(_: { ctx?: unknown; vars?: unknown }): string {
  return '¡Perfecto! Quedamos confirmados. Te escribimos antes para recordarte. ✅'
}
