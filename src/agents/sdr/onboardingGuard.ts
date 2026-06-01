import type { SessionState } from './contextStore.js'

// True when a live SDR session exists and has progressed past the initial
// triage state. In that case, the onboarding fallback ("estamos terminando
// de configurar tu acceso" copy and friends) must be suppressed — the
// prospect is mid-conversation and that copy makes the bot look broken.
//
// Returning false means: no SDR session OR the conversation hasn't really
// started (fsmState === 'triage'). Onboarding routing can proceed normally.
export function shouldSuppressOnboardingForActiveSDR(state: SessionState | null): boolean {
  if (!state) return false
  return state.fsmState !== 'triage'
}
