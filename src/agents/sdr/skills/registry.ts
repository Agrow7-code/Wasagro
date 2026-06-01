// SDR template registry.
//
// Single source of truth for which templates exist and how they're resolved
// from FSM state + classifier intent. Anti-pattern guard #5 forbids defining
// templates inline in composer.ts — they must live in this registry as
// separate files, mirrored from the Gentle-AI skill-registry pattern.
//
// Adding a new template:
//   1. Create src/agents/sdr/skills/templates/<name>.ts with a pure render fn
//   2. Import + register here (this file is the index)
//   3. Add the routing rule in resolveTemplate() if applicable
//   4. Add a test in tests/agents/sdr/templates.test.ts
//   5. Composer auto-picks it up. No edits to router.ts / sdrAgent.ts needed.

import type { ConvContext, SDRFsmState } from '../context.js'
import type { Intent } from '../../../constants/intents.js'

import { closeOffer } from './templates/close-offer.js'
import { brochureSend } from './templates/brochure-send.js'
import { calendarLink } from './templates/calendar-link.js'
import { meetingConfirm } from './templates/meeting-confirm.js'
import { gracefulExit } from './templates/graceful-exit.js'
import { willBookLater } from './templates/will-book-later.js'

export interface TemplateInput {
  ctx: ConvContext
  vars?: Record<string, unknown>
}

export type TemplateRenderer = (input: TemplateInput) => string

export const TEMPLATES = {
  closeOffer,
  brochureSend,
  calendarLink,
  meetingConfirm,
  gracefulExit,
  willBookLater,
} as const

export type TemplateKey = keyof typeof TEMPLATES

// Resolve which template to render based on FSM state + classifier intent.
// Returns null if no template applies — caller falls back to LLM (discovery
// questions, pitch body, etc. still need LLM creativity).
//
// Intent priorities override state-based defaults: if the prospect explicitly
// asked for a brochure, that wins even if fsmState says we're still 'closing'.

export function resolveTemplate(state: SDRFsmState, intent: Intent): TemplateKey | null {
  // High-priority intent overrides — what the prospect SAID wins over what
  // the bot was about to DO.
  if (intent === 'wants_brochure') return 'brochureSend'
  if (intent === 'booked') return 'meetingConfirm'
  if (intent === 'will_book_later') return 'willBookLater'
  if (intent === 'declined') return 'gracefulExit'

  // State-based defaults — when the prospect didn't override, the FSM state
  // dictates what we send.
  switch (state) {
    case 'closing':
      return 'closeOffer'
    case 'meeting_proposed':
      return 'calendarLink'
    default:
      // discovery (LLM questions), pitch_sent (LLM body + deterministic CTA),
      // objection_handling, brochure_sent (follow-up), etc.
      return null
  }
}
