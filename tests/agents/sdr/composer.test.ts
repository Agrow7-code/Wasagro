import { describe, it, expect } from 'vitest'
import { compose, composeCalendarLink } from '../../../src/agents/sdr/composer.js'
import { resolveTemplate } from '../../../src/agents/sdr/skills/registry.js'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'

const ctx = (overrides: Partial<ConvContext> = {}): ConvContext => ({
  ...createDefaultContext('p-1', '+593900000000'),
  ...overrides,
})

// ─── resolveTemplate priorities ──────────────────────────────────────────────

describe('resolveTemplate — intent overrides state', () => {
  it('wants_brochure -> brochureSend even when fsmState=discovery', () => {
    expect(resolveTemplate('discovery', 'wants_brochure')).toBe('brochureSend')
  })

  it('booked -> meetingConfirm regardless of state', () => {
    expect(resolveTemplate('triage', 'booked')).toBe('meetingConfirm')
    expect(resolveTemplate('closing', 'booked')).toBe('meetingConfirm')
  })

  it('declined -> gracefulExit even from pitch_sent', () => {
    expect(resolveTemplate('pitch_sent', 'declined')).toBe('gracefulExit')
  })

  it('will_book_later -> willBookLater', () => {
    expect(resolveTemplate('closing', 'will_book_later')).toBe('willBookLater')
  })

  it('meeting_waiting -> meetingWaiting regardless of state', () => {
    expect(resolveTemplate('meeting_proposed', 'meeting_waiting')).toBe('meetingWaiting')
    expect(resolveTemplate('meeting_confirmed', 'meeting_waiting')).toBe('meetingWaiting')
    expect(resolveTemplate('closing', 'meeting_waiting')).toBe('meetingWaiting')
  })
})

// ─── resolveTemplate state defaults ──────────────────────────────────────────

describe('resolveTemplate — state defaults when intent has no override', () => {
  it('closing + neutral intent -> closeOffer', () => {
    expect(resolveTemplate('closing', 'neutro')).toBe('closeOffer')
    expect(resolveTemplate('closing', 'advance')).toBe('closeOffer')
    expect(resolveTemplate('closing', 'other')).toBe('closeOffer')
  })

  it('meeting_proposed + neutral -> calendarLink', () => {
    expect(resolveTemplate('meeting_proposed', 'neutro')).toBe('calendarLink')
  })

  it('discovery + any non-override intent -> null (LLM falls through)', () => {
    expect(resolveTemplate('discovery', 'neutro')).toBeNull()
    expect(resolveTemplate('discovery', 'consulta')).toBeNull()
    expect(resolveTemplate('discovery', 'interest')).toBeNull()
  })

  it('pitch_sent + non-override intent -> null (pitch body is LLM)', () => {
    expect(resolveTemplate('pitch_sent', 'neutro')).toBeNull()
    expect(resolveTemplate('pitch_sent', 'interest')).toBeNull()
  })

  it('objection_handling -> null (handled in router with LLM directive for now)', () => {
    expect(resolveTemplate('objection_handling', 'neutro')).toBeNull()
  })
})

// ─── compose — end-to-end ────────────────────────────────────────────────────

describe('compose — full render', () => {
  it('returns rendered text + templateKey for closeOffer', () => {
    const r = compose('closing', 'neutro', ctx({ segmento: 'agricultor' }))
    expect(r).not.toBeNull()
    expect(r!.templateKey).toBe('closeOffer')
    expect(r!.text).toContain('agricultor')
    expect(r!.text).toContain('?')
  })

  it('returns null for LLM-only states', () => {
    expect(compose('discovery', 'neutro', ctx())).toBeNull()
    expect(compose('pitch_sent', 'interest', ctx())).toBeNull()
  })

  it('wants_brochure short-circuits and uses brochureSend regardless of state', () => {
    const r = compose('pitch_sent', 'wants_brochure', ctx({ segmento: 'agricultor' }))
    expect(r?.templateKey).toBe('brochureSend')
    expect(r?.text).toContain('?segment=agricultor')
  })

  it('declined wins over closing', () => {
    const r = compose('closing', 'declined', ctx())
    expect(r?.templateKey).toBe('gracefulExit')
  })

  it('meeting_waiting produces meetingWaiting template (no calendar link re-send)', () => {
    const r = compose('meeting_proposed', 'meeting_waiting', ctx())
    expect(r).not.toBeNull()
    expect(r!.templateKey).toBe('meetingWaiting')
    expect(r!.text.toLowerCase()).not.toContain('calend')
    expect(r!.text.toLowerCase()).not.toContain('link')
    expect(r!.text.toLowerCase()).not.toContain('horario')
  })

  it('meeting_waiting from meeting_confirmed also resolves (never re-sends link)', () => {
    const r = compose('meeting_confirmed', 'meeting_waiting', ctx())
    expect(r).not.toBeNull()
    expect(r!.templateKey).toBe('meetingWaiting')
  })
})

// ─── composeCalendarLink ─────────────────────────────────────────────────────

describe('composeCalendarLink', () => {
  it('returns the calendar link template', () => {
    const text = composeCalendarLink()
    expect(text).toMatch(/horario|día|cal|📅/i)
  })
})

// ─── Anti-pattern guard — runtime check ──────────────────────────────────────

describe('Fase A guarantees (regression guards)', () => {
  it('closeOffer NEVER mentions "casos de éxito" (Fase A removes the false promise)', () => {
    const r = compose('closing', 'neutro', ctx({ segmento: 'exportadora' }))
    expect(r!.text.toLowerCase()).not.toContain('casos de éxito')
    expect(r!.text.toLowerCase()).not.toContain('caso de éxito')
  })

  it('closeOffer NEVER starts with "Disculpa la pregunta anterior"', () => {
    const r = compose('closing', 'neutro', ctx())
    expect(r!.text.toLowerCase()).not.toMatch(/^disculp/)
  })

  it('every state we send is either template (deterministic) or null (LLM-with-purpose)', () => {
    const stateIntentPairs = [
      ['closing', 'neutro'],
      ['closing', 'wants_brochure'],
      ['meeting_proposed', 'neutro'],
      ['meeting_proposed', 'meeting_waiting'],
      ['pitch_sent', 'declined'],
    ] as const

    for (const [s, i] of stateIntentPairs) {
      const r = compose(s, i, ctx())
      expect(r).not.toBeNull()
      expect(r!.text.length).toBeGreaterThan(10)
      expect(r!.text.toLowerCase()).not.toContain('casos de éxito')
    }
  })
})
