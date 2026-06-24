import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock supabase default client before importing the module under test
vi.mock('../../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

// UMBRALES_SEVERIDAD_DEFAULT is imported from SigatokaHandler.
// We mock langfuse to avoid its initialization side effects.
vi.mock('../../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({ event: vi.fn() }),
  },
}))

import { UMBRALES_SEVERIDAD_DEFAULT } from '../../../src/pipeline/handlers/SigatokaHandler.js'
import { seedMetricasPlantilla, seedFincaConfig } from '../../../src/pipeline/supabaseQueries.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUpsertChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'neq', 'is', 'update', 'order', 'limit']
  for (const m of methods) chain[m] = vi.fn().mockReturnThis()
  chain['insert'] = vi.fn().mockReturnThis()
  chain['upsert'] = vi.fn().mockReturnThis()
  chain['then'] = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve)
  return chain
}

function makeMock(insertResult: unknown = { data: null, error: null }) {
  const chain = makeUpsertChain(insertResult)
  return { from: vi.fn().mockReturnValue(chain), _chain: chain }
}

// ─── seedMetricasPlantilla ────────────────────────────────────────────────────

describe('seedMetricasPlantilla', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('banano: inserta métricas tasa_rechazo, rendimiento_tha, matas_ha (Fix 1: NO umbrales_metrica)', async () => {
    // Fix 1: umbrales_metrica insert removed. EventHandler reads thresholds from
    // fincas.config.sigatoka_umbrales (written by seedFincaConfig), not umbrales_metrica.
    // The 'atencion' nivel was invalid (DB CHECK: bajo/medio/alto/critico only).
    let insertedMetricas: unknown[] = []
    const tablesAccessed: string[] = []

    const fromMock = vi.fn().mockImplementation((table: string) => {
      tablesAccessed.push(table)
      const chain = makeUpsertChain({ data: null, error: null })
      if (table === 'metricas_finca') {
        chain['upsert'] = vi.fn().mockImplementation((rows: unknown) => {
          insertedMetricas = Array.isArray(rows) ? rows : [rows]
          return chain
        })
        chain['insert'] = vi.fn().mockImplementation((rows: unknown) => {
          insertedMetricas = Array.isArray(rows) ? rows : [rows]
          return chain
        })
      }
      return chain
    })

    const mock = { from: fromMock }
    await seedMetricasPlantilla('ORG001', 'F001', 'banano', mock as any)

    const nombres = insertedMetricas.map((r: any) => r.nombre)
    expect(nombres).toContain('tasa_rechazo')
    expect(nombres).toContain('rendimiento_tha')
    expect(nombres).toContain('matas_ha')

    // Fix 1: umbrales_metrica must NOT be accessed
    expect(tablesAccessed).not.toContain('umbrales_metrica')
  })

  it('cacao: inserta kg_mazorca_sana e incidencia_enfermedades; NO inserta en umbrales_metrica', async () => {
    let insertedMetricas: unknown[] = []
    const tablesAccessed: string[] = []

    const fromMock = vi.fn().mockImplementation((table: string) => {
      tablesAccessed.push(table)
      const chain = makeUpsertChain({ data: null, error: null })
      if (table === 'metricas_finca') {
        chain['upsert'] = vi.fn().mockImplementation((rows: unknown) => {
          insertedMetricas = Array.isArray(rows) ? rows : [rows]
          return chain
        })
        chain['insert'] = vi.fn().mockImplementation((rows: unknown) => {
          insertedMetricas = Array.isArray(rows) ? rows : [rows]
          return chain
        })
      }
      return chain
    })

    const mock = { from: fromMock, _chain: {} }

    await seedMetricasPlantilla('ORG001', 'F001', 'cacao', mock as any)

    const nombres = insertedMetricas.map((r: any) => r.nombre)
    expect(nombres).toContain('kg_mazorca_sana')
    expect(nombres).toContain('incidencia_enfermedades')
    expect(tablesAccessed).not.toContain('umbrales_metrica')
  })

  it('cultivo desconocido: no inserta nada y no lanza error', async () => {
    const fromMock = vi.fn()
    const mock = { from: fromMock }

    await expect(seedMetricasPlantilla('ORG001', 'F001', 'cafe', mock as any)).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('re-seed del mismo finca_id: usa upsert con ON CONFLICT DO NOTHING (idempotente)', async () => {
    let upsertCalled = false
    const fromMock = vi.fn().mockImplementation((table: string) => {
      const chain = makeUpsertChain({ data: null, error: null })
      if (table === 'metricas_finca') {
        chain['upsert'] = vi.fn().mockImplementation(() => {
          upsertCalled = true
          return chain
        })
        // If insert is used with ignoreDuplicates that's also acceptable
        chain['insert'] = vi.fn().mockImplementation(() => {
          upsertCalled = true
          return chain
        })
      }
      return chain
    })

    const mock = { from: fromMock }
    await seedMetricasPlantilla('ORG001', 'F001', 'banano', mock as any)
    expect(upsertCalled).toBe(true)
  })

  it('insert falla: función resuelve sin lanzar (best-effort, P4)', async () => {
    const fromMock = vi.fn().mockImplementation(() => {
      const chain = makeUpsertChain({ data: null, error: { message: 'DB error seed' } })
      chain['upsert'] = vi.fn().mockReturnThis()
      chain['insert'] = vi.fn().mockReturnThis()
      return chain
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mock = { from: fromMock }

    await expect(seedMetricasPlantilla('ORG001', 'F001', 'banano', mock as any)).resolves.toBeUndefined()
    consoleSpy.mockRestore()
  })

  // Fix 1: umbrales_metrica insert removed because:
  // (a) 'atencion' is not in the DB CHECK (bajo/medio/alto/critico)
  // (b) EventHandler reads thresholds from fincas.config.sigatoka_umbrales (seedFincaConfig),
  //     NOT from umbrales_metrica — the row is redundant and would corrupt on invalid nivel.
  it('banano: does NOT insert into umbrales_metrica (Fix 1 — redundant + invalid nivel)', async () => {
    const tablesAccessed: string[] = []

    const fromMock = vi.fn().mockImplementation((table: string) => {
      tablesAccessed.push(table)
      const chain = makeUpsertChain({ data: null, error: null })
      chain['upsert'] = vi.fn().mockReturnThis()
      chain['insert'] = vi.fn().mockReturnThis()
      return chain
    })

    const mock = { from: fromMock }
    await seedMetricasPlantilla('ORG001', 'F001', 'banano', mock as any)

    // metricas_finca is accessed (for the metric rows)
    expect(tablesAccessed).toContain('metricas_finca')
    // umbrales_metrica must NOT be accessed — thresholds live in fincas.config
    expect(tablesAccessed).not.toContain('umbrales_metrica')
  })
})

// ─── seedFincaConfig ──────────────────────────────────────────────────────────

describe('seedFincaConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('banano: llama update en fincas con sigatoka_umbrales del default', async () => {
    let updatedConfig: unknown = null

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table !== 'fincas') throw new Error(`Unexpected table: ${table}`)
      const chain: Record<string, unknown> = {}
      // select for reading current config
      chain['select'] = vi.fn().mockReturnThis()
      chain['eq'] = vi.fn().mockReturnThis()
      chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: { config: {} }, error: null })
      chain['single'] = vi.fn().mockResolvedValue({ data: { config: {} }, error: null })
      chain['update'] = vi.fn().mockImplementation((payload: unknown) => {
        updatedConfig = payload
        return chain
      })
      chain['then'] = (resolve: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve)
      return chain
    })

    const mock = { from: fromMock }
    await seedFincaConfig('F001', 'banano', mock as any)

    expect(fromMock).toHaveBeenCalledWith('fincas')
    expect(updatedConfig).not.toBeNull()
    const cfg = (updatedConfig as Record<string, unknown>)['config'] as Record<string, unknown>
    expect(cfg).toHaveProperty('sigatoka_umbrales')
    expect(cfg['sigatoka_umbrales']).toEqual(UMBRALES_SEVERIDAD_DEFAULT)
  })

  it('cacao: no actualiza fincas.config', async () => {
    const fromMock = vi.fn()
    const mock = { from: fromMock }

    await expect(seedFincaConfig('F001', 'cacao', mock as any)).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('cultivo desconocido: no actualiza fincas.config', async () => {
    const fromMock = vi.fn()
    const mock = { from: fromMock }

    await expect(seedFincaConfig('F001', 'otro', mock as any)).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })
})
