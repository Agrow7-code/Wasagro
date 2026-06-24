import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({ supabase: {} }))

import {
  setOnboardingEstado,
  getOnboardingsTrabados,
} from '../../src/pipeline/supabaseQueries.js'

// Thenable chain: every builder method returns `this`; awaiting the chain
// resolves to the configured Supabase result ({ data, error }).
function crearChain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'or', 'order', 'update', 'insert', 'limit']) {
    c[m] = vi.fn().mockReturnValue(c)
  }
  c['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  c['maybeSingle'] = vi.fn().mockResolvedValue(result)
  c['single'] = vi.fn().mockResolvedValue(result)
  return c
}

function crearDb(result: { data: unknown; error: unknown }) {
  const chain = crearChain(result)
  return { client: { from: vi.fn().mockReturnValue(chain) } as any, chain }
}

describe('setOnboardingEstado (compare-and-set)', () => {
  it('reporta transitioned=true cuando la fila cambió de estado', async () => {
    const { client, chain } = crearDb({ data: [{ id: 'usr-1' }], error: null })

    const res = await setOnboardingEstado('usr-1', 'requiere_revision', { pasoTrabado: 4 }, client)

    expect(res.transitioned).toBe(true)
    // compare-and-set: solo escribe cuando el estado actual difiere del destino
    expect(chain['neq']).toHaveBeenCalledWith('onboarding_estado', 'requiere_revision')
    expect(chain['eq']).toHaveBeenCalledWith('id', 'usr-1')
  })

  it('reporta transitioned=false cuando ya estaba en el estado destino (no-op)', async () => {
    const { client } = crearDb({ data: [], error: null })

    const res = await setOnboardingEstado('usr-1', 'requiere_revision', {}, client)

    expect(res.transitioned).toBe(false)
  })

  it('al pasar a completo setea onboarding_completo=true y stampa completado_at', async () => {
    const { client, chain } = crearDb({ data: [{ id: 'usr-1' }], error: null })

    await setOnboardingEstado('usr-1', 'completo', {}, client)

    const patch = (chain['update'] as any).mock.calls[0][0]
    expect(patch.onboarding_estado).toBe('completo')
    expect(patch.onboarding_completo).toBe(true)
    expect(patch.onboarding_completado_at).toBeTruthy()
  })

  it('esperando_explicacion NO marca onboarding_completo', async () => {
    const { client, chain } = crearDb({ data: [{ id: 'usr-1' }], error: null })

    await setOnboardingEstado('usr-1', 'esperando_explicacion', {}, client)

    const patch = (chain['update'] as any).mock.calls[0][0]
    expect(patch.onboarding_estado).toBe('esperando_explicacion')
    expect(patch.onboarding_completo).toBeUndefined()
  })

  it('requiere_revision registra el paso_trabado', async () => {
    const { client, chain } = crearDb({ data: [{ id: 'usr-1' }], error: null })

    await setOnboardingEstado('usr-1', 'requiere_revision', { pasoTrabado: 7 }, client)

    const patch = (chain['update'] as any).mock.calls[0][0]
    expect(patch.paso_trabado).toBe(7)
  })

  it('propaga el error de Supabase', async () => {
    const { client } = crearDb({ data: null, error: new Error('DB error') })

    await expect(setOnboardingEstado('usr-1', 'completo', {}, client)).rejects.toThrow('DB error')
  })
})

describe('getOnboardingsTrabados', () => {
  it('retorna los onboardings trabados con su motivo derivado', async () => {
    const { client } = crearDb({
      data: [
        { id: 'u1', phone: '1', nombre: 'A', finca_id: 'F001', org_id: 'ORG1', onboarding_estado: 'requiere_revision', status: 'activo', paso_trabado: 5, onboarding_iniciado_at: 't', updated_at: 't' },
        { id: 'u2', phone: '2', nombre: 'B', finca_id: 'F002', org_id: 'ORG2', onboarding_estado: 'rechazo_consentimiento', status: 'activo', paso_trabado: null, onboarding_iniciado_at: 't', updated_at: 't' },
        { id: 'u3', phone: '3', nombre: 'C', finca_id: 'F003', org_id: 'ORG3', onboarding_estado: 'en_progreso', status: 'pendiente_aprobacion', paso_trabado: null, onboarding_iniciado_at: 't', updated_at: 't' },
      ],
      error: null,
    })

    const res = await getOnboardingsTrabados(client)

    expect(res).toHaveLength(3)
    expect(res[0]!.motivo).toBe('requiere_revision')
    expect(res[1]!.motivo).toBe('rechazo_consentimiento')
    expect(res[2]!.motivo).toBe('pendiente_aprobacion')
  })

  it('retorna [] cuando no hay trabados', async () => {
    const { client } = crearDb({ data: [], error: null })
    expect(await getOnboardingsTrabados(client)).toEqual([])
  })

  it('propaga el error de Supabase', async () => {
    const { client } = crearDb({ data: null, error: new Error('DB error') })
    await expect(getOnboardingsTrabados(client)).rejects.toThrow('DB error')
  })
})
