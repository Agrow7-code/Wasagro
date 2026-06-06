import type { SDRFsmState } from './context.js'

// LangFuse score values for SDR funnel conversion widgets.
//
// Why these three only:
//   pitch_sent / closing / brochure_sent / meeting_proposed are in-flight
//   states — they don't represent a final outcome, so scoring them would
//   confuse "win rate" / "conversion rate" widgets. We only score the
//   terminal transitions: won, lost, abandoned.
//
//   +1 meeting_confirmed — prospecto agendó (vía Cal.com or in-conversation).
//    0 dormant            — prospecto se fue silencioso (chaser timeout).
//   -1 declined           — prospecto dijo no explícitamente.
const SCORE_VALUES: Partial<Record<SDRFsmState, number>> = {
  meeting_confirmed: 1,
  declined: -1,
  dormant: 0,
}

export function isTerminalSDRState(s: SDRFsmState): boolean {
  return s in SCORE_VALUES
}

export interface SDROutcomeMeta {
  prospectoId: string
  phone: string
  narrativa?: string | null
  cultivo?: string | null
  segmento?: string | null
  turnCount?: number
  source?: 'router' | 'meeting_confirmation' | 'chaser_dormant' | 'calcom_webhook'
}

// Minimal subset of langfuse.Trace#score we use. Decoupling makes the helper
// trivially mockable in tests and keeps the import surface small.
export interface ScoreSink {
  score: (opts: { name: string; value: number; comment?: string }) => unknown
}

// Idempotent scoring: only emits when `to` is terminal AND `from !== to`. This
// way the helper can be called unconditionally after every FSM transition
// without producing duplicate scores for prospects who re-enter the same
// terminal state (e.g. dormant → dormant on chaser ticks).
export function scoreTerminalTransition(
  sink: ScoreSink,
  from: SDRFsmState,
  to: SDRFsmState,
  meta: SDROutcomeMeta,
): boolean {
  const value = SCORE_VALUES[to]
  if (value === undefined) return false
  if (from === to) return false
  sink.score({
    name:    'sdr_outcome',
    value,
    comment: JSON.stringify({ from, to, ...meta }),
  })
  return true
}
