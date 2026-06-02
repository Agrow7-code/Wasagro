import { z } from 'zod'
import {
  IntentEnum,
  ObjectionTypeEnum,
  intentToObjectionType,
  type Intent,
  type ObjectionType,
} from '../../constants/intents.js'

// Re-export so consumers (router, classifier, composer) have one import surface.
export type { Intent, ObjectionType } from '../../constants/intents.js'

// ─── Domain enums (Zod) ───────────────────────────────────────────────────────

export const CultivoEnum = z.enum([
  'cacao', 'banano', 'cafe', 'aguacate', 'pina', 'palma', 'arroz', 'maiz', 'otro',
])
export type Cultivo = z.infer<typeof CultivoEnum>

export const SegmentoEnum = z.enum([
  'exportadora', 'cooperativa', 'agricultor', 'ong', 'desconocido',
])
export type Segmento = z.infer<typeof SegmentoEnum>

// FSM states for the refactored SDR flow. Coexists with the legacy SDRNode
// in src/types/dominio/SDRTypes.ts during the migration — Commit 2 wires
// router.ts to consume these. Until then, this enum is the target state model.
export const SDRFsmStateEnum = z.enum([
  'triage',
  'discovery',
  'pitch_sent',
  'objection_handling',
  'closing',
  'brochure_sent',
  'meeting_proposed',
  'meeting_confirmed',
  'declined',
  'dormant',
])
export type SDRFsmState = z.infer<typeof SDRFsmStateEnum>

export const BotActionEnum = z.enum([
  'ask_question',
  'sent_pitch',
  'sent_brochure',
  'sent_calendar_link',
  'sent_meeting_confirmation',
  'sent_meeting_waiting_ack',
  'sent_graceful_exit',
  'none',
])
export type BotAction = z.infer<typeof BotActionEnum>

export const SignalStrengthEnum = z.enum(['hot', 'warm', 'cold', 'unknown'])
export type SignalStrength = z.infer<typeof SignalStrengthEnum>

// ─── ConversationContext ──────────────────────────────────────────────────────
// Source of truth for the conversation. Hydrated from Supabase + Redis,
// mutated only via reduceContext() below. Contract frozen in ADR-009.

export const ConvContextSchema = z.object({
  // Identity (persistent — sdr_prospectos)
  prospectId: z.string(),
  phone: z.string(),

  // Prospect facts (persistent — sdr_prospectos)
  cultivo: CultivoEnum.nullable(),
  pais: z.string().nullable(),
  fincasEstimadas: z.number().int().positive().nullable(),
  segmento: SegmentoEnum,
  sistemaActual: z.string().nullable(),

  // Conversation state (session-scoped — Redis / sesiones_activas)
  fsmState: SDRFsmStateEnum,
  lastBotAction: BotActionEnum,
  lastBotMessage: z.string().nullable(),
  turnCount: z.number().int().nonnegative(),
  intentHistory: z.array(IntentEnum).max(20),
  lastObjectionType: ObjectionTypeEnum.nullable(),

  // Derived signals (recomputed by reducer — never set directly)
  signalStrength: SignalStrengthEnum,
  datosConocidos: z.number().int().min(0).max(5),
  clarificationTurnsUsed: z.number().int().min(0).max(2),
})

export type ConvContext = z.infer<typeof ConvContextSchema>

// ─── Reducer inputs ───────────────────────────────────────────────────────────

export interface IntentClassification {
  intent: Intent
  confidence: number
}

export interface ExtractionUpdate {
  cultivo?: Cultivo | null
  pais?: string | null
  fincasEstimadas?: number | null
  sistemaActual?: string | null
  segmento?: Segmento | null
}

export interface ReduceInput {
  classification: IntentClassification
  extraction?: ExtractionUpdate
  botAction?: BotAction        // what the bot did in this turn (set by composer in Commit 2)
  botMessage?: string | null   // text the bot sent (for disambiguating short replies like "Ya?")
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INTENT_HISTORY = 20
const MAX_CLARIFICATION_TURNS = 2

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function createDefaultContext(prospectId: string, phone: string): ConvContext {
  return {
    prospectId,
    phone,
    cultivo: null,
    pais: null,
    fincasEstimadas: null,
    segmento: 'desconocido',
    sistemaActual: null,
    fsmState: 'triage',
    lastBotAction: 'none',
    lastBotMessage: null,
    turnCount: 0,
    intentHistory: [],
    lastObjectionType: null,
    signalStrength: 'unknown',
    datosConocidos: 0,
    clarificationTurnsUsed: 0,
  }
}

// FSM transition table — pure function of (current state, intent).
// No LLM, no IO, fully testable. Exported so router.ts can dry-run the
// transition BEFORE the actual reduce, in order to pick the right template /
// directive for the message it's about to send.
export function computeFsmTransition(current: SDRFsmState, intent: Intent): SDRFsmState {
  return nextFsmState(current, intent)
}

function nextFsmState(current: SDRFsmState, intent: Intent): SDRFsmState {
  // Terminal-ish intents short-circuit the FSM
  if (intent === 'declined') return 'declined'
  if (intent === 'booked' && current !== 'meeting_confirmed') return 'meeting_confirmed'

  // meeting_waiting: prospect is in/awaiting the scheduled meeting.
  // Absorb in both meeting_proposed and meeting_confirmed — never regress.
  if (intent === 'meeting_waiting') {
    if (current === 'meeting_proposed' || current === 'meeting_confirmed') return 'meeting_confirmed'
  }

  switch (current) {
    case 'triage':
      return 'discovery'
    case 'discovery':
      // Stay in discovery; router decides discovery -> pitch transition based on datosConocidos
      return 'discovery'
    case 'pitch_sent':
      if (intent === 'objection_price' || intent === 'objection_time' || intent === 'objection_trust') {
        return 'objection_handling'
      }
      if (intent === 'advance' || intent === 'interest' || intent === 'other') return 'closing'
      return 'pitch_sent'
    case 'objection_handling':
      if (intent === 'advance' || intent === 'interest') return 'closing'
      return 'objection_handling'
    case 'closing':
      if (intent === 'wants_brochure') return 'brochure_sent'
      if (intent === 'will_book_later') return 'meeting_proposed'
      return 'closing'
    case 'brochure_sent':
      if (intent === 'interest' || intent === 'advance') return 'closing'
      return 'brochure_sent'
    case 'meeting_proposed':
      return 'meeting_proposed'
    case 'meeting_confirmed':
      return 'meeting_confirmed'
    case 'declined':
      return 'declined'
    case 'dormant':
      if (intent === 'interest' || intent === 'advance' || intent === 'wants_brochure') return 'closing'
      return 'dormant'
    default:
      return current
  }
}

// Derive datosConocidos from filled prospect fields (max 5: cultivo, pais, fincas, sistema, segmento).
function countDatos(p: Pick<ConvContext, 'cultivo' | 'pais' | 'fincasEstimadas' | 'sistemaActual' | 'segmento'>): number {
  let n = 0
  if (p.cultivo) n++
  if (p.pais) n++
  if (p.fincasEstimadas !== null && p.fincasEstimadas !== undefined) n++
  if (p.sistemaActual) n++
  if (p.segmento !== 'desconocido') n++
  return n
}

// Derive signal strength from the recent intent pattern (last 5 turns).
// Hot = at least 3 positive signals and no cold ones.
// Cold = 2+ negative signals (declined, objection_trust).
// Warm = at least 1 positive.
// Unknown = empty history or all neutral.
function deriveSignalStrength(history: readonly Intent[]): SignalStrength {
  if (history.length === 0) return 'unknown'
  const HOT: ReadonlySet<Intent> = new Set([
    'advance', 'interest', 'wants_brochure', 'booked', 'will_book_later',
  ])
  const COLD: ReadonlySet<Intent> = new Set(['declined', 'objection_trust'])
  const recent = history.slice(-5)
  let hot = 0
  let cold = 0
  for (const i of recent) {
    if (HOT.has(i)) hot++
    if (COLD.has(i)) cold++
  }
  if (cold >= 2) return 'cold'
  if (hot >= 3 && cold === 0) return 'hot'
  if (hot >= 1) return 'warm'
  return 'unknown'
}

// Clarification counter:
// - Only counts when the previous bot turn was an explicit question
//   AND the user response was conversational neutral (didn't answer it).
// - Capped at MAX_CLARIFICATION_TURNS (P2 invariant).
// - Reset is the FSM's job, not the reducer's.
function nextClarificationCount(
  current: number,
  prevBotAction: BotAction,
  intent: Intent,
): number {
  if (prevBotAction !== 'ask_question') return current
  if (intent === 'consulta' || intent === 'neutro' || intent === 'other') {
    return Math.min(current + 1, MAX_CLARIFICATION_TURNS)
  }
  return current
}

// ─── THE REDUCER ──────────────────────────────────────────────────────────────
// Pure function: same input → same output. No LLM, no DB, no fetch.
// Anti-pattern guard #3 of ADR-009 forbids mutating prospect fields outside of here.

export function reduceContext(ctx: ConvContext, input: ReduceInput): ConvContext {
  const { classification, extraction = {}, botAction, botMessage } = input

  // 1. Apply extraction — never overwrite a confirmed value.
  //    A confirmed value (non-null in ctx) always wins. Extraction only fills
  //    null/missing fields. If the prospect contradicts themselves later, the
  //    update has to go through an explicit confirmation flow, not via the
  //    classifier extraction silently swapping the value.
  const cultivo = ctx.cultivo ?? extraction.cultivo ?? null
  const pais = ctx.pais ?? extraction.pais ?? null
  const fincasEstimadas = ctx.fincasEstimadas ?? extraction.fincasEstimadas ?? null
  const sistemaActual = ctx.sistemaActual ?? extraction.sistemaActual ?? null

  // Segmento: only upgrade from 'desconocido', never downgrade or change.
  const segmento: Segmento =
    ctx.segmento === 'desconocido' && extraction.segmento
      ? extraction.segmento
      : ctx.segmento

  // 2. Append intent to history (sliding window of MAX_INTENT_HISTORY).
  const intentHistory: Intent[] = [...ctx.intentHistory, classification.intent].slice(-MAX_INTENT_HISTORY)

  // 3. Last objection type — set when intent is an objection, else carry forward.
  const lastObjectionType = intentToObjectionType(classification.intent) ?? ctx.lastObjectionType

  // 4. FSM transition (pure).
  const fsmState = nextFsmState(ctx.fsmState, classification.intent)

  // 5. Clarification counter (based on PREVIOUS bot action + this intent).
  const clarificationTurnsUsed = nextClarificationCount(
    ctx.clarificationTurnsUsed,
    ctx.lastBotAction,
    classification.intent,
  )

  // 6. Derived signals.
  const datosConocidos = countDatos({ cultivo, pais, fincasEstimadas, sistemaActual, segmento })
  const signalStrength = deriveSignalStrength(intentHistory)

  return {
    prospectId: ctx.prospectId,
    phone: ctx.phone,
    cultivo,
    pais,
    fincasEstimadas,
    sistemaActual,
    segmento,
    fsmState,
    lastBotAction: botAction ?? ctx.lastBotAction,
    lastBotMessage: botMessage !== undefined ? botMessage : ctx.lastBotMessage,
    turnCount: ctx.turnCount + 1,
    intentHistory,
    lastObjectionType,
    signalStrength,
    datosConocidos,
    clarificationTurnsUsed,
  }
}
