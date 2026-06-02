import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'
import { closeOffer } from '../../../src/agents/sdr/skills/templates/close-offer.js'
import { brochureSend } from '../../../src/agents/sdr/skills/templates/brochure-send.js'
import { calendarLink } from '../../../src/agents/sdr/skills/templates/calendar-link.js'
import { meetingConfirm } from '../../../src/agents/sdr/skills/templates/meeting-confirm.js'
import { meetingWaiting } from '../../../src/agents/sdr/skills/templates/meeting-waiting.js'
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
  const ORIGINAL_DEMO = process.env['DEMO_BOOKING_URL']
  const ORIGINAL_CALCOM = process.env['CALCOM_BOOKING_URL']

  afterEach(() => {
    if (ORIGINAL_DEMO === undefined) delete process.env['DEMO_BOOKING_URL']
    else process.env['DEMO_BOOKING_URL'] = ORIGINAL_DEMO
    if (ORIGINAL_CALCOM === undefined) delete process.env['CALCOM_BOOKING_URL']
    else process.env['CALCOM_BOOKING_URL'] = ORIGINAL_CALCOM
  })

  it('returns CALCOM_BOOKING_URL when set (takes priority over DEMO_BOOKING_URL)', () => {
    process.env['CALCOM_BOOKING_URL'] = 'https://cal.com/wasagro/demo'
    process.env['DEMO_BOOKING_URL'] = 'https://calendly.com/old'
    expect(calendarLink({})).toContain('https://cal.com/wasagro/demo')
    expect(calendarLink({})).not.toContain('calendly')
  })

  it('falls back to DEMO_BOOKING_URL when CALCOM_BOOKING_URL is not set', () => {
    delete process.env['CALCOM_BOOKING_URL']
    process.env['DEMO_BOOKING_URL'] = 'https://calendly.com/old'
    expect(calendarLink({})).toContain('https://calendly.com/old')
  })

  it('falls back to question when neither is set', () => {
    delete process.env['CALCOM_BOOKING_URL']
    delete process.env['DEMO_BOOKING_URL']
    expect(calendarLink({})).toMatch(/qué día y hora/i)
  })
})

// ─── static templates ───────────────────────────────────────────────────────

describe('meetingConfirm / meetingWaiting / gracefulExit / willBookLater', () => {
  it('meetingConfirm is a short positive acknowledgement', () => {
    const text = meetingConfirm({})
    expect(text).toMatch(/perfecto|listo|confirm/i)
    expect(text.length).toBeLessThan(150)
  })

  it('meetingWaiting never re-sends calendar link or brochure', () => {
    const text = meetingWaiting({})
    expect(text).toMatch(/seguida|equipo|avisas/i)
    expect(text.toLowerCase()).not.toContain('calend')
    expect(text.toLowerCase()).not.toContain('link')
    expect(text.toLowerCase()).not.toContain('horario')
    expect(text.toLowerCase()).not.toContain('brochure')
    expect(text.toLowerCase()).not.toContain('agendar')
  })

  it('meetingWaiting is short and warm', () => {
    const text = meetingWaiting({})
    expect(text.length).toBeLessThan(150)
    expect(text).toMatch(/perfecto/i)
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

  it('all four are deterministic', () => {
    expect(meetingConfirm({})).toBe(meetingConfirm({}))
    expect(meetingWaiting({})).toBe(meetingWaiting({}))
    expect(gracefulExit({})).toBe(gracefulExit({}))
    expect(willBookLater({})).toBe(willBookLater({}))
  })
})
