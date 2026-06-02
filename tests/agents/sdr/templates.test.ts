import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'
import { closeOffer } from '../../../src/agents/sdr/skills/templates/close-offer.js'
import { brochureSend } from '../../../src/agents/sdr/skills/templates/brochure-send.js'
import { calendarLink } from '../../../src/agents/sdr/skills/templates/calendar-link.js'
import { meetingConfirm } from '../../../src/agents/sdr/skills/templates/meeting-confirm.js'
import { gracefulExit } from '../../../src/agents/sdr/skills/templates/graceful-exit.js'
import { willBookLater } from '../../../src/agents/sdr/skills/templates/will-book-later.js'

const ctx = (overrides: Partial<ConvContext> = {}): ConvContext => ({
  ...createDefaultContext('p-1', '+593900000000'),
  ...overrides,
})

// ─── closeOffer ──────────────────────────────────────────────────────────────

describe('closeOffer', () => {
  it('includes the prospect segmento when known', () => {
    const text = closeOffer({ ctx: ctx({ segmento: 'agricultor' }) })
    expect(text).toContain('agricultor')
    expect(text).toMatch(/30 minutos/i)
  })

  it('falls back to "tu segmento" when segmento is desconocido', () => {
    const text = closeOffer({ ctx: ctx({ segmento: 'desconocido' }) })
    expect(text).toContain('tu segmento')
    expect(text).not.toContain('undefined')
  })

  it('does NOT mention "casos de éxito" — that promise was the bug Fase A solves', () => {
    const text = closeOffer({ ctx: ctx() })
    expect(text.toLowerCase()).not.toContain('casos de éxito')
    expect(text.toLowerCase()).not.toContain('caso de éxito')
    expect(text.toLowerCase()).not.toContain('case studies')
  })

  it('does NOT start with "Disculpa la pregunta anterior" — the LLM regression Fase A removes', () => {
    const text = closeOffer({ ctx: ctx() })
    expect(text.toLowerCase()).not.toMatch(/^disculp/)
  })

  it('ends with a question (close offer is always a question)', () => {
    const text = closeOffer({ ctx: ctx() })
    expect(text.trim()).toMatch(/[?]/)
  })

  it('is deterministic — same ctx, same output', () => {
    const c = ctx({ segmento: 'exportadora' })
    expect(closeOffer({ ctx: c })).toBe(closeOffer({ ctx: c }))
  })
})

// ─── brochureSend ────────────────────────────────────────────────────────────

describe('brochureSend', () => {
  const ORIGINAL_URL = process.env['WASAGRO_BROCHURE_URL']

  beforeEach(() => {
    process.env['WASAGRO_BROCHURE_URL'] = 'https://wasagro.vercel.app/brochure'
  })

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env['WASAGRO_BROCHURE_URL']
    else process.env['WASAGRO_BROCHURE_URL'] = ORIGINAL_URL
  })

  it('URL contains the agricultor slug when segmento=agricultor', () => {
    const text = brochureSend({ ctx: ctx({ segmento: 'agricultor' }) })
    expect(text).toContain('?segment=agricultor')
  })

  it('URL contains the exportadora slug when segmento=exportadora', () => {
    const text = brochureSend({ ctx: ctx({ segmento: 'exportadora' }) })
    expect(text).toContain('?segment=exportadora')
  })

  it('cooperativa maps to agricultor brochure (no cooperativa brochure exists yet)', () => {
    const text = brochureSend({ ctx: ctx({ segmento: 'cooperativa' }) })
    expect(text).toContain('?segment=agricultor')
  })

  it('desconocido falls back to agricultor (the safer default)', () => {
    const text = brochureSend({ ctx: ctx({ segmento: 'desconocido' }) })
    expect(text).toContain('?segment=agricultor')
  })

  it('uses WASAGRO_BROCHURE_URL when set', () => {
    process.env['WASAGRO_BROCHURE_URL'] = 'https://example.com/brochure'
    const text = brochureSend({ ctx: ctx({ segmento: 'agricultor' }) })
    expect(text).toContain('https://example.com/brochure?segment=agricultor')
  })

  it('falls back to default URL when env var is missing', () => {
    delete process.env['WASAGRO_BROCHURE_URL']
    const text = brochureSend({ ctx: ctx({ segmento: 'agricultor' }) })
    expect(text).toContain('https://wasagro.vercel.app/brochure?segment=agricultor')
  })
})

// ─── calendarLink ────────────────────────────────────────────────────────────

describe('calendarLink', () => {
  const ORIGINAL_URL = process.env['DEMO_BOOKING_URL']

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env['DEMO_BOOKING_URL']
    else process.env['DEMO_BOOKING_URL'] = ORIGINAL_URL
  })

  it('returns the booking URL when DEMO_BOOKING_URL is set', () => {
    process.env['DEMO_BOOKING_URL'] = 'https://cal.com/x'
    expect(calendarLink({})).toContain('https://cal.com/x')
  })

  it('falls back to question when DEMO_BOOKING_URL is missing', () => {
    delete process.env['DEMO_BOOKING_URL']
    expect(calendarLink({})).toMatch(/qué día y hora/i)
  })
})

// ─── static templates ───────────────────────────────────────────────────────

describe('meetingConfirm / gracefulExit / willBookLater', () => {
  it('meetingConfirm is a short positive acknowledgement', () => {
    const text = meetingConfirm({})
    expect(text).toMatch(/perfecto|listo|confirm/i)
    expect(text.length).toBeLessThan(150)
  })

  it('gracefulExit acknowledges + leaves the door open', () => {
    const text = gracefulExit({})
    expect(text).toMatch(/entiendo|no hay problema/i)
    expect(text).toMatch(/algún momento|si en algún|aquí estaremos/i)
  })

  it('willBookLater acknowledges without nagging', () => {
    const text = willBookLater({})
    expect(text).toMatch(/perfecto|listo|espera/i)
    expect(text).toMatch(/cuando tengas|usas el link/i)
  })

  it('all three are deterministic', () => {
    expect(meetingConfirm({})).toBe(meetingConfirm({}))
    expect(gracefulExit({})).toBe(gracefulExit({}))
    expect(willBookLater({})).toBe(willBookLater({}))
  })
})
