// Pure decision logic for onboarding terminal/recovery outcomes (change:
// onboarding-hardening). No LLM, no DB, no side effects — testable in isolation.
// The handler wires sender/DB/alert around the outcome this returns.

import type { OnboardingEstado } from './supabaseQueries.js'

/** Step ceiling — outer hard stop. Env-overridable. */
export const ONBOARDING_MAX_STEPS = Number(process.env['ONBOARDING_MAX_STEPS'] ?? 10)
/** Per-step clarification attempts — P2 structural backstop (inner stop). */
export const ONBOARDING_MAX_STEP_ATTEMPTS = Number(process.env['ONBOARDING_MAX_STEP_ATTEMPTS'] ?? 2)

export type OnboardingOutcome =
  | { kind: 'continue' }
  | { kind: 'complete' }
  | { kind: 'stuck'; pasoTrabado: number }
  | { kind: 'consent_rejected' }

export interface DesenlaceInput {
  onboardingCompleto: boolean
  /** datos.consentimiento === false AND consent was not already given. */
  consentRejected: boolean
  pasoSiguiente: number
  /** Reducer-tracked attempts on the current step (caps at the P2 invariant). */
  clarificationTurnsUsed: number
  maxSteps?: number
  maxStepAttempts?: number
}

/**
 * Decides the terminal/recovery outcome of an onboarding turn. Precedence:
 *   1. consent rejection (P6 terminal — overrides everything)
 *   2. completion (monotonic — already guarded by the reducer)
 *   3. stuck: step ceiling OR per-step attempt limit reached (P2 backstop,
 *      independent of whether the LLM advanced `siguiente_paso`)
 *   4. continue
 */
export function decidirDesenlaceOnboarding(input: DesenlaceInput): OnboardingOutcome {
  const maxSteps = input.maxSteps ?? ONBOARDING_MAX_STEPS
  const maxAttempts = input.maxStepAttempts ?? ONBOARDING_MAX_STEP_ATTEMPTS

  if (input.consentRejected) return { kind: 'consent_rejected' }
  if (input.onboardingCompleto) return { kind: 'complete' }

  const ceilingHit = input.pasoSiguiente >= maxSteps
  const attemptsExhausted = input.clarificationTurnsUsed >= maxAttempts
  if (ceilingHit || attemptsExhausted) {
    return { kind: 'stuck', pasoTrabado: input.pasoSiguiente }
  }
  return { kind: 'continue' }
}

const ESTADOS_TERMINALES: ReadonlySet<string> = new Set<OnboardingEstado>([
  'requiere_revision',
  'rechazo_consentimiento',
])

/** True when an onboarding state must short-circuit routing (no restart, no
 *  event handling) — the structural fix for the infinite restart loop (#1). */
export function esEstadoOnboardingTerminal(estado: string | null | undefined): boolean {
  return estado != null && ESTADOS_TERMINALES.has(estado)
}

/** Static holding copy for a user who is already in a terminal onboarding
 *  state (no LLM call). Follows prompt voice: tuteo, ≤3 lines, only ✅/⚠️. */
export function mensajeEnEspera(estado: string): string {
  if (estado === 'rechazo_consentimiento') {
    return 'Entendido, no hay problema. Si cambias de idea, escríbeme cuando quieras.'
  }
  return 'Ya tomé nota de tu información. Tu equipo la va a revisar y te contactan en breve ✅'
}
