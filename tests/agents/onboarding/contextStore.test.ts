import { describe, it, expect } from 'vitest'
import {
  hydrateOnboardingContext,
  toContextoConversacion,
  toContextoAgricultor,
  serializeContextForSession,
  type OnboardingSessionRow,
} from '../../../src/agents/onboarding/contextStore.js'
import {
  createDefaultContext,
  reduceOnboardingContext,
} from '../../../src/agents/onboarding/context.js'

const USER = { id: 'u-1', phone: '+593900000000' }

function makeSession(contextoParcial: Record<string, unknown>, clarificationCount = 0): OnboardingSessionRow {
  return {
    session_id: 'sess-1',
    contexto_parcial: contextoParcial,
    clarification_count: clarificationCount,
  }
}

// ─── hydrateOnboardingContext ───────────────────────────────────────────────

describe('hydrateOnboardingContext — new path (ctx key present)', () => {
  it('returns the schema-validated ctx as-is', () => {
    const seeded = reduceOnboardingContext(
      createDefaultContext('u-1', '+593900000000', 'admin'),
      { extraction: { nombre: 'Carlos', fincaNombre: 'Finca Uno' }, pasoCompletado: 1, pasoSiguiente: 2 },
    )
    const session = makeSession({ ctx: seeded })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.nombre).toBe('Carlos')
    expect(out.fincaNombre).toBe('Finca Uno')
    expect(out.pasoCompletado).toBe(1)
    expect(out.pasoSiguiente).toBe(2)
  })

  it('falls back to legacy path when ctx fails schema validation (drift)', () => {
    const corruptCtx = { userId: 123, phone: 'not-a-phone-format', tipoFlujo: 'bogus' }  // invalid
    const session = makeSession({ ctx: corruptCtx, historial: [{ rol: 'usuario', contenido: 'hola' }], datos: { nombre: 'Carlos' } })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    // Schema validation failed → legacy path used → values from legacy keys
    expect(out.nombre).toBe('Carlos')
    expect(out.historial).toHaveLength(1)
  })
})

describe('hydrateOnboardingContext — legacy path (historial + datos + consent_saved)', () => {
  it('builds ctx from legacy historial + datos keys', () => {
    const session = makeSession({
      historial: [
        { rol: 'agente', contenido: '¿Cómo te llamas?' },
        { rol: 'usuario', contenido: 'Soy Carlos' },
      ],
      datos: {
        nombre: 'Carlos',
        rol: 'propietario',
        finca_nombre: 'Finca Uno',
        cultivo_principal: 'cacao',
        pais: 'EC',
      },
    }, 2)
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.userId).toBe('u-1')
    expect(out.phone).toBe('+593900000000')
    expect(out.tipoFlujo).toBe('admin')
    expect(out.nombre).toBe('Carlos')
    expect(out.rol).toBe('propietario')
    expect(out.fincaNombre).toBe('Finca Uno')
    expect(out.cultivoPrincipal).toBe('cacao')
    expect(out.pais).toBe('EC')
    expect(out.historial).toHaveLength(2)
    expect(out.pasoSiguiente).toBe(3)  // clarification_count(2) + 1
    expect(out.pasoCompletado).toBe(1)
  })

  it('consent_saved=true legacy flag hidrata consentimiento=true', () => {
    const session = makeSession({ consent_saved: true, datos: {} })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.consentimiento).toBe(true)
  })

  it('datos.consentimiento=true sin consent_saved tambien hidrata consentimiento=true', () => {
    const session = makeSession({ datos: { consentimiento: true } })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.consentimiento).toBe(true)
  })

  it('empty session → returns defaults', () => {
    const session = makeSession({})
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.nombre).toBe(null)
    expect(out.consentimiento).toBe(false)
    expect(out.historial).toEqual([])
    expect(out.pasoSiguiente).toBe(1)
  })

  it('historial > 20 entries en legacy is sliced to 20 most recent', () => {
    const long = Array.from({ length: 25 }, (_, i) => ({ rol: 'usuario' as const, contenido: `m-${i}` }))
    const session = makeSession({ historial: long })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.historial).toHaveLength(20)
    expect(out.historial[0]?.contenido).toBe('m-5')
  })

  it('reads lotes array from datos with proper shape', () => {
    const session = makeSession({
      datos: {
        lotes: [
          { nombre_coloquial: 'Lote A', hectareas: 5 },
          { nombre_coloquial: 'Lote B', hectareas: null },
          { nombre_coloquial: '', hectareas: 1 },  // dropped (empty name)
          'not-a-lote',                              // dropped (not object)
        ],
      },
    })
    const out = hydrateOnboardingContext(session, USER, 'admin')
    expect(out.lotes).toHaveLength(2)
    expect(out.lotes[0]?.nombre_coloquial).toBe('Lote A')
    expect(out.lotes[1]?.hectareas).toBe(null)
  })

  it('agricultor flow honors tipoFlujo argument', () => {
    const out = hydrateOnboardingContext(makeSession({}), USER, 'agricultor')
    expect(out.tipoFlujo).toBe('agricultor')
  })

  it('handles missing contexto_parcial gracefully', () => {
    const out = hydrateOnboardingContext(
      { session_id: 's', contexto_parcial: null as any, clarification_count: 0 },
      USER,
      'admin',
    )
    expect(out.nombre).toBe(null)
  })
})

// ─── Legacy LLM bridges ─────────────────────────────────────────────────────

describe('toContextoConversacion (admin LLM bridge)', () => {
  it('serializes datos with snake_case keys for legacy LLM signature', () => {
    const ctx = reduceOnboardingContext(
      createDefaultContext('u', 'p', 'admin'),
      { extraction: { nombre: 'Ana', fincaNombre: 'Finca X', cultivoPrincipal: 'cacao' } },
    )
    const out = toContextoConversacion(ctx)
    expect(out.historial).toEqual([])
    expect(out.preguntas_realizadas).toBe(0)
    expect(out.datos_recolectados).toMatchObject({
      nombre: 'Ana',
      finca_nombre: 'Finca X',
      cultivo_principal: 'cacao',
    })
  })

  it('preguntas_realizadas refleja clarificationTurnsUsed del ctx', () => {
    let ctx = createDefaultContext('u', 'p', 'admin')
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })
    ctx = reduceOnboardingContext(ctx, { pasoCompletado: 1 })  // counter -> 1
    const out = toContextoConversacion(ctx)
    expect(out.preguntas_realizadas).toBe(1)
  })
})

describe('toContextoAgricultor (agricultor LLM bridge)', () => {
  it('includes fincas_disponibles param verbatim', () => {
    const ctx = createDefaultContext('u', 'p', 'agricultor')
    const out = toContextoAgricultor(ctx, '- F001: Finca Uno (cacao)')
    expect(out.fincas_disponibles).toBe('- F001: Finca Uno (cacao)')
    expect(out.paso_actual).toBe(1)
  })

  it('paso_actual refleja pasoSiguiente del ctx', () => {
    const ctx = reduceOnboardingContext(
      createDefaultContext('u', 'p', 'agricultor'),
      { pasoSiguiente: 4 },
    )
    const out = toContextoAgricultor(ctx, '')
    expect(out.paso_actual).toBe(4)
  })
})

// ─── Serialization ──────────────────────────────────────────────────────────

describe('serializeContextForSession', () => {
  it('writes both ctx AND legacy keys for partial-deploy back-compat', () => {
    const ctx = reduceOnboardingContext(
      createDefaultContext('u-1', '+593900000000', 'admin'),
      {
        extraction:    { nombre: 'Carlos', fincaNombre: 'Finca Uno', consentimiento: true },
        botMessage:    '¿Cuál es tu cultivo?',
        userMessage:   'Soy Carlos',
        pasoCompletado: 2,
        pasoSiguiente:  3,
      },
    )
    const out = serializeContextForSession(ctx)

    // New path: full ctx serialized
    expect(out['ctx']).toEqual(ctx)

    // Legacy keys: historial + datos + consent_saved (so old code reads correctly)
    expect(out['historial']).toEqual(ctx.historial)
    expect(out['datos']).toMatchObject({
      nombre: 'Carlos',
      finca_nombre: 'Finca Uno',
      consentimiento: true,
    })
    expect(out['consent_saved']).toBe(true)
  })

  it('round-trips: serialize → deserialize via hydrate gives equivalent ctx', () => {
    const original = reduceOnboardingContext(
      createDefaultContext('u-1', '+593900000000', 'agricultor'),
      {
        extraction:    { nombre: 'Pedro', fincaId: 'F002', consentimiento: true },
        userMessage:   'Hola',
        botMessage:    '¿En qué finca?',
        pasoCompletado: 1,
        pasoSiguiente:  2,
      },
    )
    const serialized = serializeContextForSession(original)
    const rehydrated = hydrateOnboardingContext(
      { session_id: 's', contexto_parcial: serialized, clarification_count: 99 },
      USER,
      'agricultor',
    )
    // The hydrate path takes the `ctx` key first, ignoring clarification_count.
    expect(rehydrated).toEqual(original)
  })
})
