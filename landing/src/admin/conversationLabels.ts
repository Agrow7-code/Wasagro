// fix/founder-crm-attention-label — shared between Inbox and Funnel so the
// founder sees a SPECIFIC, actionable reason instead of a generic
// "Requiere atención" marker. Returns null when the conversation does not
// need attention (handoff_status !== 'human_paused').
export function attentionLabel(row: { handoff_status: string; handoff_reason: string | null }): string | null {
  if (row.handoff_status !== 'human_paused') return null
  if (row.handoff_reason === 'auto_human_request') return 'Pidió hablar con una persona'
  return 'En pausa — la tomaste vos'
}
