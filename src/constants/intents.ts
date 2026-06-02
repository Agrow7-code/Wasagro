import { z } from 'zod'

// Single source of truth for SDR intents.
// Both the classifier (Fase B) and the FSM/reducer (Fase C) import from here.
// Anti-pattern guard #2 of ADR-009 forbids duplicating these strings elsewhere.

export const IntentEnum = z.enum([
  // Positive flow signals
  'wants_brochure',
  'booked',
  'will_book_later',
  'advance',
  'interest',

  // Post-meeting — prospect is in/awaiting the scheduled meeting
  'meeting_waiting',

  // Objections (split by type so the FSM can branch)
  'objection_price',
  'objection_time',
  'objection_trust',

  // Negative/terminal
  'declined',

  // Conversational neutrals
  'consulta',
  'neutro',

  // Fallback — must always be loggeable in LangFuse, never silenced
  'other',
])

export type Intent = z.infer<typeof IntentEnum>

export const ObjectionTypeEnum = z.enum(['precio', 'tiempo', 'confianza', 'producto'])
export type ObjectionType = z.infer<typeof ObjectionTypeEnum>

// Classifier confidence threshold below which the orchestrator should treat
// the prediction as 'other' (Fase D validator will enforce this).
export const CONFIDENCE_THRESHOLD = 0.7

// Maps an Intent to its corresponding ObjectionType, or null if not an objection.
// Pure helper — no LLM, used by the reducer.
export function intentToObjectionType(intent: Intent): ObjectionType | null {
  if (intent === 'objection_price') return 'precio'
  if (intent === 'objection_time') return 'tiempo'
  if (intent === 'objection_trust') return 'confianza'
  return null
}
