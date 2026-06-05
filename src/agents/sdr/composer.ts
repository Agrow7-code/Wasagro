// SDR message composer.
//
// Decides which deterministic template (if any) renders this turn's message.
// If no template applies (discovery questions, pitch body), returns null and
// the caller falls back to the LLM with a directive.
//
// This is the single function that should be called from router.ts and
// sdrAgent.ts to produce structural messages. Anti-pattern guard #5 enforces
// no inline TEMPLATES = { ... } objects outside this file (templates live in
// ./skills/templates/, indexed by ./skills/registry.ts).

import type { ConvContext, SDRFsmState } from './context.js'
import type { Intent } from '../../constants/intents.js'
import { TEMPLATES, resolveTemplate, type TemplateKey } from './skills/registry.js'

export interface ComposeResult {
  templateKey: TemplateKey
  text: string
}

// Discovery questions intentionally fall through to the LLM (return null) so
// each pregunta puede ser contextual ("¿Cómo manejás las dosis de mancozeb en
// el lote 3?" gana al genérico "¿Cómo registran hoy las labores?"). El bug
// histórico de la disculpa innecesaria ("Disculpá la pregunta anterior...")
// está cubierto por el validator `noUnnecessaryApology` (Fase D, 2cf2940) que
// strip-leading lo que matchee /^\s*(disculp[áa]|perdón)/i. Si el validator
// dispara > 10% en 24h, el SP-SDR-03 prompt está rotto y necesita fix, no un
// nuevo template determinista — ese es el principio "validators como
// observabilidad" del ADR-009 §Fase D.
//
// Returns the rendered message + the template key used (for telemetry).
// Returns null when no template applies — caller uses LLM.
export function compose(state: SDRFsmState, intent: Intent, ctx: ConvContext): ComposeResult | null {
  const key = resolveTemplate(state, intent)
  if (!key) return null
  const text = TEMPLATES[key]({ ctx })
  return { templateKey: key, text }
}

// Helper: produce the calendar-link follow-up that ships right after the
// close offer (or right after a meeting confirmation). Always deterministic.
// prospecto_id is appended as a Cal.com query param so the webhook can match
// the booking to the prospect reliably.
export function composeCalendarLink(prospectoId?: string): string {
  const input: { ctx?: unknown; vars?: Record<string, unknown> } = {}
  if (prospectoId) input.vars = { prospecto_id: prospectoId }
  return TEMPLATES.calendarLink(input)
}
