import { describe, expect, it } from 'vitest'
import {
  decidirDesenlaceOnboarding,
  esEstadoOnboardingTerminal,
  mensajeEnEspera,
} from '../../src/pipeline/onboardingOutcome.js'

const base = {
  onboardingCompleto: false,
  consentRejected: false,
  pasoSiguiente: 3,
  clarificationTurnsUsed: 0,
  maxSteps: 10,
  maxStepAttempts: 2,
}

describe('decidirDesenlaceOnboarding', () => {
  it('continúa en el camino normal', () => {
    expect(decidirDesenlaceOnboarding(base)).toEqual({ kind: 'continue' })
  })

  it('rechazo de consentimiento gana sobre todo lo demás (P6)', () => {
    const out = decidirDesenlaceOnboarding({ ...base, consentRejected: true, onboardingCompleto: true })
    expect(out).toEqual({ kind: 'consent_rejected' })
  })

  it('completa cuando onboardingCompleto', () => {
    expect(decidirDesenlaceOnboarding({ ...base, onboardingCompleto: true })).toEqual({ kind: 'complete' })
  })

  it('marca stuck al tocar el techo de pasos', () => {
    const out = decidirDesenlaceOnboarding({ ...base, pasoSiguiente: 10 })
    expect(out).toEqual({ kind: 'stuck', pasoTrabado: 10 })
  })

  it('marca stuck al agotar los intentos por paso (backstop P2), aunque el LLM no avance', () => {
    // pasoSiguiente bajo (LLM no avanzó), pero clarificaciones agotadas
    const out = decidirDesenlaceOnboarding({ ...base, pasoSiguiente: 3, clarificationTurnsUsed: 2 })
    expect(out).toEqual({ kind: 'stuck', pasoTrabado: 3 })
  })

  it('NO marca stuck con intentos por debajo del límite', () => {
    expect(decidirDesenlaceOnboarding({ ...base, clarificationTurnsUsed: 1 })).toEqual({ kind: 'continue' })
  })

  it('completar tiene precedencia sobre stuck (no marca trabado un onboarding que terminó)', () => {
    const out = decidirDesenlaceOnboarding({ ...base, onboardingCompleto: true, pasoSiguiente: 10 })
    expect(out).toEqual({ kind: 'complete' })
  })
})

describe('esEstadoOnboardingTerminal', () => {
  it('es terminal para requiere_revision y rechazo_consentimiento', () => {
    expect(esEstadoOnboardingTerminal('requiere_revision')).toBe(true)
    expect(esEstadoOnboardingTerminal('rechazo_consentimiento')).toBe(true)
  })

  it('NO es terminal para estados activos/transitorios', () => {
    for (const e of ['no_iniciado', 'en_progreso', 'esperando_explicacion', 'completo', null, undefined]) {
      expect(esEstadoOnboardingTerminal(e)).toBe(false)
    }
  })
})

describe('mensajeEnEspera', () => {
  it('da copy distinto para rechazo de consentimiento', () => {
    expect(mensajeEnEspera('rechazo_consentimiento')).toMatch(/cambias de idea/i)
  })
  it('da copy de revisión para requiere_revision', () => {
    expect(mensajeEnEspera('requiere_revision')).toMatch(/revisar|revise|en breve/i)
  })
})
