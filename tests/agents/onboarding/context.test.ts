import { describe, it, expect } from 'vitest'
import {
  OnboardingContextSchema,
  createDefaultContext,
  reduceOnboardingContext,
  buildContextoForLLM,
  mapDatosToExtraction,
  type OnboardingContext,
} from '../../../src/agents/onboarding/context.js'

// ─── Schema validation ──────────────────────────────────────────────────────

describe('OnboardingContextSchema', () => {
  it('createDefaultContext produces a schema-valid context', () => {
    const ctx = createDefaultContext('u-1', '+593987654321', 'admin')
    expect(OnboardingContextSchema.safeParse(ctx).success).toBe(true)
  })

  it('createDefaultContext defaults consentimiento=false, onboardingCompleto=false', () => {
    const ctx = createDefaultContext('u-1', '+593987654321', 'admin')
    expect(ctx.consentimiento).toBe(false)
    expect(ctx.onboardingCompleto).toBe(false)
    expect(ctx.pasoCompletado).toBe(0)
    expect(ctx.pasoSiguiente).toBe(1)
    expect(ctx.clarificationTurnsUsed).toBe(0)
    expect(ctx.lotes).toEqual([])
    expect(ctx.historial).toEqual([])
  })

  it('agricultor flow is also valid', () => {
    const ctx = createDefaultContext('u-2', '+593987654322', 'agricultor')
    expect(OnboardingContextSchema.safeParse(ctx).success).toBe(true)
    expect(ctx.tipoFlujo).toBe('agricultor')
  })

  it('rejects historial with more than 20 entries (sliding window enforced at schema)', () => {
    const ctx = createDefaultContext('u-3', '+593900000000', 'admin')
    const oversized: OnboardingContext = {
      ...ctx,
      historial: Array.from({ length: 21 }, (_, i) => ({
        rol: 'usuario' as const,
        contenido: `msg-${i}`,
      })),
    }
    expect(OnboardingContextSchema.safeParse(oversized).success).toBe(false)
  })

  it('rejects clarificationTurnsUsed > 2 (P2 invariant)', () => {
    const ctx = createDefaultContext('u-4', '+593900000000', 'admin')
    const broken: OnboardingContext = { ...ctx, clarificationTurnsUsed: 3 }
    expect(OnboardingContextSchema.safeParse(broken).success).toBe(false)
  })
})

// ─── Reducer: extraction merging ────────────────────────────────────────────

describe('reduceOnboardingContext — extraction merging', () => {
  const base = (): OnboardingContext => createDefaultContext('u-1', '+593900000000', 'admin')

  it('fills null fields from extraction', () => {
    const ctx = reduceOnboardingContext(base(), {
      extraction: {
        nombre:           'Carlos',
        rol:              'propietario',
        fincaNombre:      'Finca Uno',
        cultivoPrincipal: 'cacao',
      },
    })
    expect(ctx.nombre).toBe('Carlos')
    expect(ctx.rol).toBe('propietario')
    expect(ctx.fincaNombre).toBe('Finca Uno')
    expect(ctx.cultivoPrincipal).toBe('cacao')
  })

  it('NEVER overwrites a confirmed (non-null) field via extraction', () => {
    const ctx1 = reduceOnboardingContext(base(), { extraction: { nombre: 'Carlos' } })
    const ctx2 = reduceOnboardingContext(ctx1, { extraction: { nombre: 'Roberto' } })
    expect(ctx2.nombre).toBe('Carlos')  // confirmed value wins
  })

  it('extraction with no fields is a no-op for facts', () => {
    const ctx1 = reduceOnboardingContext(base(), { extraction: { nombre: 'Ana' } })
    const ctx2 = reduceOnboardingContext(ctx1, { extraction: {} })
    expect(ctx2.nombre).toBe('Ana')
  })

  it('lotes: latest extraction replaces array entirely (handler decides ordering)', () => {
    const ctx1 = reduceOnboardingContext(base(), {
      extraction: { lotes: [{ nombre_coloquial: 'El de arriba', hectareas: 2 }] },
    })
    const ctx2 = reduceOnboardingContext(ctx1, {
      extraction: {
        lotes: [
          { nombre_coloquial: 'El de arriba', hectareas: 2 },
          { nombre_coloquial: 'El de abajo',  hectareas: 3 },
        ],
      },
    })
    expect(ctx2.lotes).toHaveLength(2)
    expect(ctx2.lotes[1]?.nombre_coloquial).toBe('El de abajo')
  })

  it('lotes: empty/missing extraction keeps current lotes', () => {
    const ctx1 = reduceOnboardingContext(base(), {
      extraction: { lotes: [{ nombre_coloquial: 'Lote', hectareas: 1 }] },
    })
    const ctx2 = reduceOnboardingContext(ctx1, { extraction: {} })
    expect(ctx2.lotes).toHaveLength(1)
  })
})

// ─── Reducer: monotonic flags ───────────────────────────────────────────────

describe('reduceOnboardingContext — monotonic flags', () => {
  const base = (): OnboardingContext => createDefaultContext('u-1', '+593900000000', 'admin')

  it('consentimiento: false → true via extraction sticks', () => {
    const ctx = reduceOnboardingContext(base(), {
      extraction: { consentimiento: true },
    })
    expect(ctx.consentimiento).toBe(true)
  })

  it('consentimiento: once true, never flips to false', () => {
    const ctx1 = reduceOnboardingContext(base(), { extraction: { consentimiento: true } })
    const ctx2 = reduceOnboardingContext(ctx1, { extraction: { consentimiento: false } })
    expect(ctx2.consentimiento).toBe(true)
  })

  it('consentimiento: extraction null/undefined does not change current value', () => {
    const ctx1 = reduceOnboardingContext(base(), { extraction: { consentimiento: true } })
    const ctx2 = reduceOnboardingContext(ctx1, { extraction: { consentimiento: null } })
    expect(ctx2.consentimiento).toBe(true)
  })

  it('onboardingCompleto: false → true sticks', () => {
    const ctx = reduceOnboardingContext(base(), { onboardingCompleto: true })
    expect(ctx.onboardingCompleto).toBe(true)
  })

  it('onboardingCompleto: once true, never un-completes even if LLM says false', () => {
    const ctx1 = reduceOnboardingContext(base(), { onboardingCompleto: true })
    const ctx2 = reduceOnboardingContext(ctx1, { onboardingCompleto: false })
    expect(ctx2.onboardingCompleto).toBe(true)
  })
})

// ─── Reducer: historial sliding window ──────────────────────────────────────

describe('reduceOnboardingContext — historial', () => {
  const base = (): OnboardingContext => createDefaultContext('u-1', '+593900000000', 'admin')

  it('appends userMessage and botMessage in order', () => {
    const ctx = reduceOnboardingContext(base(), {
      userMessage: 'Hola',
      botMessage:  '¿Cómo te llamas?',
    })
    expect(ctx.historial).toEqual([
      { rol: 'usuario', contenido: 'Hola' },
      { rol: 'agente',  contenido: '¿Cómo te llamas?' },
    ])
  })

  it('ignores empty/null messages (does not push blank entries)', () => {
    const ctx = reduceOnboardingContext(base(), {
      userMessage: '',
      botMessage:  null,
    })
    expect(ctx.historial).toEqual([])
  })

  it('slides window when exceeding 20 entries', () => {
    let ctx = base()
    for (let i = 0; i < 15; i++) {
      ctx = reduceOnboardingContext(ctx, {
        userMessage: `user-${i}`,
        botMessage:  `bot-${i}`,
      })
    }
    expect(ctx.historial.length).toBe(20)
    // Oldest 10 entries dropped
    expect(ctx.historial[0]?.contenido).toBe('user-5')
    expect(ctx.historial.at(-1)?.contenido).toBe('bot-14')
  })
})

// ─── Reducer: clarification counter ─────────────────────────────────────────

describe('reduceOnboardingContext — clarification counter', () => {
  const base = (): OnboardingContext => createDefaultContext('u-1', '+593900000000', 'admin')

  it('increments when paso does not advance (LLM asked again at same step)', () => {
    let ctx = reduceOnboardingContext(base(), { pasoCompletado: 1, pasoSiguiente: 2 })
    expect(ctx.clarificationTurnsUsed).toBe(0)
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1, pasoSiguiente: 2 })
    expect(ctx.clarificationTurnsUsed).toBe(1)
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1, pasoSiguiente: 2 })
    expect(ctx.clarificationTurnsUsed).toBe(2)
  })

  it('caps at 2 (P2 invariant)', () => {
    let ctx = reduceOnboardingContext(base(), { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    expect(ctx.clarificationTurnsUsed).toBe(2)
  })

  it('resets to 0 when paso advances', () => {
    let ctx = reduceOnboardingContext(base(), { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    expect(ctx.clarificationTurnsUsed).toBe(1)
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 2 })
    expect(ctx.clarificationTurnsUsed).toBe(0)
  })

  it('does not touch counter when pasoCompletado is omitted', () => {
    let ctx = reduceOnboardingContext(base(), { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    expect(ctx.clarificationTurnsUsed).toBe(1)
    ctx = reduceOnboardingContext(ctx, { extraction: { nombre: 'X' } })
    expect(ctx.clarificationTurnsUsed).toBe(1)
  })
})

// ─── Bridge helpers ─────────────────────────────────────────────────────────

describe('buildContextoForLLM', () => {
  it('admin flow does not include fincas_disponibles even when passed', () => {
    const ctx = createDefaultContext('u-1', '+593900000000', 'admin')
    const out = buildContextoForLLM(ctx, '- F001: Finca Uno')
    expect(out).not.toContain('Fincas disponibles')
  })

  it('agricultor flow includes fincas_disponibles when provided', () => {
    const ctx = createDefaultContext('u-2', '+593900000000', 'agricultor')
    const out = buildContextoForLLM(ctx, '- F001: Finca Uno (cacao)')
    expect(out).toContain('Fincas disponibles: - F001: Finca Uno (cacao)')
  })

  it('serializes datos_recopilados with snake_case keys for LLM', () => {
    const base = createDefaultContext('u-1', '+593900000000', 'admin')
    const ctx = reduceOnboardingContext(base, {
      extraction: { nombre: 'Carlos', fincaNombre: 'Finca Uno', cultivoPrincipal: 'cacao' },
    })
    const out = buildContextoForLLM(ctx)
    // The serialized datos block should use snake_case (matches the LLM prompt contract).
    expect(out).toContain('"finca_nombre":"Finca Uno"')
    expect(out).toContain('"cultivo_principal":"cacao"')
  })

  it('includes pasoSiguiente and nombre at the top', () => {
    const ctx = reduceOnboardingContext(
      createDefaultContext('u-1', '+593900000000', 'admin'),
      { extraction: { nombre: 'Ana' }, pasoSiguiente: 3 },
    )
    expect(ctx.pasoSiguiente).toBe(3)
    const out = buildContextoForLLM(ctx)
    expect(out).toContain('Paso siguiente: 3')
    expect(out).toContain('Nombre del usuario: Ana')
  })
})

describe('mapDatosToExtraction', () => {
  it('translates snake_case LLM keys to camelCase ExtractionUpdate', () => {
    const datos = {
      nombre: 'Carlos',
      rol: 'propietario',
      consentimiento: true,
      finca_nombre: 'Finca Uno',
      finca_ubicacion_texto: 'Babahoyo',
      finca_id: 'F001',
      cultivo_principal: 'cacao',
      pais: 'EC',
      lotes: [{ nombre_coloquial: 'Lote A', hectareas: 5 }],
    }
    const out = mapDatosToExtraction(datos)
    expect(out).toEqual({
      nombre: 'Carlos',
      rol: 'propietario',
      consentimiento: true,
      fincaNombre: 'Finca Uno',
      fincaUbicacionTexto: 'Babahoyo',
      fincaId: 'F001',
      cultivoPrincipal: 'cacao',
      pais: 'EC',
      lotes: [{ nombre_coloquial: 'Lote A', hectareas: 5 }],
    })
  })

  it('omits keys that are undefined (preserves "not present" semantics)', () => {
    const out = mapDatosToExtraction({ nombre: 'Ana' })
    expect(out).toEqual({ nombre: 'Ana' })
    expect('fincaNombre' in out).toBe(false)
  })

  it('preserves explicit null (different from undefined per reducer contract)', () => {
    const out = mapDatosToExtraction({ nombre: null, finca_nombre: null })
    expect(out.nombre).toBe(null)
    expect(out.fincaNombre).toBe(null)
  })
})

// ─── Determinism + immutability ─────────────────────────────────────────────

describe('reduceOnboardingContext — pure function guarantees', () => {
  it('does not mutate the input context (immutability)', () => {
    const ctx = createDefaultContext('u-1', '+593900000000', 'admin')
    const snapshot = JSON.parse(JSON.stringify(ctx))
    reduceOnboardingContext(ctx, {
      extraction: { nombre: 'Carlos', consentimiento: true },
      pasoCompletado: 1,
      userMessage: 'hola',
    })
    expect(ctx).toEqual(snapshot)
  })

  it('same input twice produces equal output (determinism)', () => {
    const ctx = createDefaultContext('u-1', '+593900000000', 'admin')
    const input = {
      extraction: { nombre: 'Carlos', consentimiento: true },
      pasoCompletado: 2,
      pasoSiguiente:  3,
      userMessage:    'hola',
      botMessage:     '¿cuántas fincas?',
    }
    const a = reduceOnboardingContext(ctx, input)
    const b = reduceOnboardingContext(ctx, input)
    expect(a).toEqual(b)
  })
})
