import { describe, it, expect } from 'vitest'
import {
  endsWithQuestion,
  noFalsePromises,
  noUnnecessaryApology,
  pipeValidators,
} from '../../../src/agents/sdr/validators.js'
import { createDefaultContext, type ConvContext } from '../../../src/agents/sdr/context.js'

const ctx = (overrides: Partial<ConvContext> = {}): ConvContext => ({
  ...createDefaultContext('p-1', '+593900000000'),
  ...overrides,
})

// ─── endsWithQuestion ────────────────────────────────────────────────────────

describe('endsWithQuestion', () => {
  it('does not fire when last sentence ends with ?', () => {
    const out = endsWithQuestion.apply(
      'Con Wasagro grabás un audio y queda registrado. ¿Te hace sentido?',
      ctx(),
    )
    expect(out.triggered).toBe(false)
    expect(out.fixed).toBe('Con Wasagro grabás un audio y queda registrado. ¿Te hace sentido?')
  })

  it('appends a CTA when last sentence is declarative', () => {
    const out = endsWithQuestion.apply(
      'Wasagro te ahorra horas de registro a mano y evita pérdidas con alertas tempranas.',
      ctx({ turnCount: 0 }),
    )
    expect(out.triggered).toBe(true)
    expect(out.autofixType).toBe('append_cta')
    expect(out.fixed).toMatch(/\?$/)
    // Original text preserved before the CTA
    expect(out.fixed).toContain('Wasagro te ahorra horas')
  })

  it('picks different CTAs across consecutive turns (no repeat in a row)', () => {
    const t1 = endsWithQuestion.apply('Hola.', ctx({ turnCount: 0 })).fixed
    const t2 = endsWithQuestion.apply('Hola.', ctx({ turnCount: 1 })).fixed
    expect(t1).not.toBe(t2)
  })

  it('treats empty string as no-op', () => {
    const out = endsWithQuestion.apply('   ', ctx())
    expect(out.triggered).toBe(false)
  })

  it('handles trailing whitespace around the question mark', () => {
    const out = endsWithQuestion.apply('¿Te suena?   ', ctx())
    expect(out.triggered).toBe(false)
  })
})

// ─── noFalsePromises ─────────────────────────────────────────────────────────

describe('noFalsePromises', () => {
  it('removes the "casos de éxito" sentence and emits autofix', () => {
    const out = noFalsePromises.apply(
      'Wasagro lleva 6 meses funcionando. Te paso un PDF con casos de éxito de la región. ¿Te lo mando?',
      ctx(),
    )
    expect(out.triggered).toBe(true)
    expect(out.autofixType).toBe('drop_sentence')
    expect(out.fixed).not.toMatch(/casos de [ée]xito/i)
    // Other sentences survive
    expect(out.fixed).toContain('Wasagro lleva 6 meses funcionando')
    expect(out.fixed).toContain('¿Te lo mando?')
  })

  it('removes "case studies" variant', () => {
    const out = noFalsePromises.apply(
      'Mira nuestras case studies. ¿Querés verlas?',
      ctx(),
    )
    expect(out.triggered).toBe(true)
    expect(out.fixed).not.toMatch(/case stud/i)
  })

  it('removes "testimonios de clientes" variant', () => {
    const out = noFalsePromises.apply(
      'Tenemos testimonios de otros clientes que pasaron por lo mismo. ¿Te interesa?',
      ctx(),
    )
    expect(out.triggered).toBe(true)
    expect(out.fixed).not.toMatch(/testimonios/i)
  })

  it('does not fire on benign mention of "exito"', () => {
    const out = noFalsePromises.apply(
      'Para el éxito de tu cosecha registrá las labores. ¿Te ayudo a arrancar?',
      ctx(),
    )
    expect(out.triggered).toBe(false)
  })

  it('does not modify text without false promises', () => {
    const original = '¿Cómo registran hoy las labores en tu finca?'
    const out = noFalsePromises.apply(original, ctx())
    expect(out.triggered).toBe(false)
    expect(out.fixed).toBe(original)
  })
})

// ─── noUnnecessaryApology ────────────────────────────────────────────────────

describe('noUnnecessaryApology', () => {
  it('strips leading "Disculpá la pregunta anterior..."', () => {
    const out = noUnnecessaryApology.apply(
      'Disculpá la pregunta anterior, no era necesaria. ¿Cuántas hectáreas manejás?',
      ctx({ lastBotAction: 'ask_question' }),
    )
    expect(out.triggered).toBe(true)
    expect(out.autofixType).toBe('strip_leading_apology')
    expect(out.fixed).toBe('¿Cuántas hectáreas manejás?')
  })

  it('strips leading "Disculpá si te confundí..."', () => {
    const out = noUnnecessaryApology.apply(
      'Disculpá si te confundí antes. Wasagro es para registrar labores con audio. ¿Te suena?',
      ctx({ lastBotAction: 'sent_pitch' }),
    )
    expect(out.triggered).toBe(true)
    expect(out.fixed).toContain('Wasagro es para registrar')
    expect(out.fixed).not.toMatch(/^\s*disculp/i)
  })

  it('strips leading "Perdón por..."', () => {
    const out = noUnnecessaryApology.apply(
      'Perdón por la confusión. ¿Cuántas fincas manejás?',
      ctx(),
    )
    expect(out.triggered).toBe(true)
    expect(out.fixed).toBe('¿Cuántas fincas manejás?')
  })

  it('does not fire when the bot did not begin with an apology', () => {
    const out = noUnnecessaryApology.apply(
      'Wasagro es ideal para tu operación. ¿Te interesa una demo?',
      ctx(),
    )
    expect(out.triggered).toBe(false)
  })
})

// ─── pipe ────────────────────────────────────────────────────────────────────

describe('pipeValidators', () => {
  it('chains validators: apology stripped + CTA appended', () => {
    const out = pipeValidators(
      'Perdón por la pregunta anterior. Wasagro te ahorra horas.',
      ctx({ turnCount: 2 }),
    )
    const names = out.triggered.map(t => t.name)
    expect(names).toContain('noUnnecessaryApology')
    expect(names).toContain('endsWithQuestion')
    expect(out.text).not.toMatch(/^\s*perd/i)
    expect(out.text).toMatch(/\?$/)
  })

  it('no validators fire on already-correct message', () => {
    const out = pipeValidators(
      '¿Cómo registran hoy las labores en tu finca?',
      ctx(),
    )
    expect(out.triggered).toHaveLength(0)
    expect(out.text).toBe('¿Cómo registran hoy las labores en tu finca?')
  })

  it('removes false promise AND appends CTA when both issues coexist', () => {
    const out = pipeValidators(
      'Wasagro tiene casos de éxito en el sector. Te encantará.',
      ctx({ turnCount: 0 }),
    )
    const names = out.triggered.map(t => t.name)
    expect(names).toContain('noFalsePromises')
    expect(names).toContain('endsWithQuestion')
    expect(out.text).not.toMatch(/casos de [ée]xito/i)
    expect(out.text).toMatch(/\?$/)
  })
})
