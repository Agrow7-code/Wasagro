import { describe, it, expect } from 'vitest'
import { shouldSuppressOnboardingForActiveSDR } from '../../../src/agents/sdr/onboardingGuard.js'
import type { SessionState } from '../../../src/agents/sdr/contextStore.js'

function makeState(fsmState: SessionState['fsmState']): SessionState {
  return {
    fsmState,
    lastBotAction: 'none',
    lastBotMessage: null,
    intentHistory: [],
    lastObjectionType: null,
    signalStrength: 'cold',
    clarificationTurnsUsed: 0,
  }
}

describe('shouldSuppressOnboardingForActiveSDR', () => {
  it('no dispara mensaje de onboarding si fsmState = discovery', () => {
    expect(shouldSuppressOnboardingForActiveSDR(makeState('discovery'))).toBe(true)
  })

  it('no dispara mensaje de onboarding si fsmState = pitch_sent', () => {
    expect(shouldSuppressOnboardingForActiveSDR(makeState('pitch_sent'))).toBe(true)
  })

  it('sí dispara mensaje de onboarding si fsmState = triage (estado inicial)', () => {
    expect(shouldSuppressOnboardingForActiveSDR(makeState('triage'))).toBe(false)
  })

  it('sí dispara mensaje de onboarding si no hay session state (sin SDR previo)', () => {
    expect(shouldSuppressOnboardingForActiveSDR(null)).toBe(false)
  })
})
