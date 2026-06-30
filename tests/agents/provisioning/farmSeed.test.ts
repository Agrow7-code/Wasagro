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
import { seedMetricasPlantilla, seedUmbralesAlertaDefaults } from '../../../src/pipeline/supabaseQueries.js'

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


// ─── seedUmbralesAlertaDefaults (PR#4 — replaces seedFincaConfig for new orgs) ─
// Post-cutover: new banano orgs/fincas get their Sigatoka org-defaults seeded
// into umbrales_alerta (the new source of truth). Without this, a finca onboarded
// AFTER migration 073 would have NO rows and Sigatoka alerts would be silent (R3).
//
// Contract (mirrors migration 073 seed values):
//   ee3a6Severo gt  10  enabled=true
//   ee2Avanzado gt   5  enabled=true
//   hojasFuncionalesMin lt 9 enabled=true
//   ee2Leve     gt  30  enabled=false   (placeholder — silenced until agrónomo sign-off)
//
// Idempotent: upsert with onConflict:'uq_umbrales_alerta_scope' (same as upsertUmbralAlerta).
// Best-effort: never throws — logs error, never re-throws.
// Only runs for banano (non-banano orgs have no Sigatoka alerts).

describe('seedUmbralesAlertaDefaults (PR#4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('banano: upserts 4 sigatoka_negra org-default rows into umbrales_alerta', async () => {
    let upsertedRows: unknown[] = []
    const tablesAccessed: string[] = []

    const fromMock = vi.fn().mockImplementation((table: string) => {
      tablesAccessed.push(table)
      const chain: Record<string, unknown> = {}
      const methods = ['select', 'eq', 'order', 'limit']
      for (const m of methods) chain[m] = vi.fn().mockReturnThis()
      chain['upsert'] = vi.fn().mockImplementation((rows: unknown) => {
        upsertedRows = Array.isArray(rows) ? rows : [rows]
        return chain
      })
      chain['then'] = (resolve: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve)
      return chain
    })

    const mock = { from: fromMock }
    await seedUmbralesAlertaDefaults('ORG001', 'banano', mock as any)

    // Must write to umbrales_alerta (not fincas.config)
    expect(tablesAccessed).toContain('umbrales_alerta')
    expect(tablesAccessed).not.toContain('fincas')

    // 4 rows inserted
    expect(upsertedRows).toHaveLength(4)

    const rows = upsertedRows as Array<Record<string, unknown>>
    const campos = rows.map(r => r['campo'])
    expect(campos).toContain('ee3a6Severo')
    expect(campos).toContain('ee2Avanzado')
    expect(campos).toContain('hojasFuncionalesMin')
    expect(campos).toContain('ee2Leve')

    // All rows scoped to org (finca_id null = org-default)
    for (const row of rows) {
      expect(row['org_id']).toBe('ORG001')
      expect(row['finca_id']).toBeNull()
      expect(row['pest_type']).toBe('sigatoka_negra')
    }

    // J/I/M enabled=true; H (ee2Leve) enabled=false (placeholder silenced)
    const ee3a6 = rows.find(r => r['campo'] === 'ee3a6Severo')!
    expect(ee3a6['enabled']).toBe(true)
    expect(ee3a6['valor']).toBe(10)
    expect(ee3a6['operador']).toBe('gt')

    const ee2av = rows.find(r => r['campo'] === 'ee2Avanzado')!
    expect(ee2av['enabled']).toBe(true)
    expect(ee2av['valor']).toBe(5)
    expect(ee2av['operador']).toBe('gt')

    const hfMin = rows.find(r => r['campo'] === 'hojasFuncionalesMin')!
    expect(hfMin['enabled']).toBe(true)
    expect(hfMin['valor']).toBe(9)
    expect(hfMin['operador']).toBe('lt')

    const ee2leve = rows.find(r => r['campo'] === 'ee2Leve')!
    expect(ee2leve['enabled']).toBe(false) // silenced placeholder
    expect(ee2leve['valor']).toBe(30)
    expect(ee2leve['operador']).toBe('gt')
  })

  it('cacao: no-op (no Sigatoka alerts for non-banano crops)', async () => {
    const fromMock = vi.fn()
    const mock = { from: fromMock }

    await expect(seedUmbralesAlertaDefaults('ORG001', 'cacao', mock as any)).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('cultivo desconocido: no-op', async () => {
    const fromMock = vi.fn()
    const mock = { from: fromMock }

    await expect(seedUmbralesAlertaDefaults('ORG001', 'otro', mock as any)).resolves.toBeUndefined()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('upsert falla: resuelve sin lanzar (best-effort, P4)', async () => {
    const fromMock = vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain['upsert'] = vi.fn().mockReturnThis()
      chain['then'] = (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: { message: 'DB error' } }).then(resolve)
      return chain
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mock = { from: fromMock }

    await expect(seedUmbralesAlertaDefaults('ORG001', 'banano', mock as any)).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('idempotent: upsert uses uq_umbrales_alerta_scope onConflict so re-seed is a no-op', async () => {
    let upsertOptions: unknown = null

    const fromMock = vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain['upsert'] = vi.fn().mockImplementation((_rows: unknown, opts: unknown) => {
        upsertOptions = opts
        return chain
      })
      chain['then'] = (resolve: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve)
      return chain
    })

    const mock = { from: fromMock }
    await seedUmbralesAlertaDefaults('ORG001', 'banano', mock as any)

    // Must use named constraint — same as upsertUmbralAlerta (H8, Fix 4)
    expect(upsertOptions).toMatchObject({ onConflict: 'uq_umbrales_alerta_scope' })
  })
})

// ─── Post-cutover regression: org-default-only path fires J/I/M (PR#4 invariant) ─
// After dual-read removal, a finca with ONLY org-default rows (no per-finca override)
// must still fire J/I/M alerts. This test proves that resolveUmbrales + toUmbralesSeveridad
// correctly resolves org-default rows into J/I/M-firing thresholds.

import {
  resolveUmbrales as _resolveUmbrales,
  toUmbralesSeveridad as _toUmbralesSeveridad,
  type UmbralAlertaRow as _UmbralAlertaRow,
} from '../../../src/pipeline/handlers/umbralesAlerta.js'

describe('Post-cutover: org-default-only finca still fires J/I/M (PR#4 safety)', () => {
  // Simulates the rows that seedUmbralesAlertaDefaults inserts for a brand-new banano org
  // that onboarded AFTER migration 073. These are org-default rows (finca_id=null).
  const orgDefaultRows: _UmbralAlertaRow[] = [
    { id: 'r1', org_id: 'ORG002', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo',        operador: 'gt', valor: 10, enabled: true  },
    { id: 'r2', org_id: 'ORG002', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'ee2Avanzado',        operador: 'gt', valor: 5,  enabled: true  },
    { id: 'r3', org_id: 'ORG002', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'hojasFuncionalesMin',operador: 'lt', valor: 9,  enabled: true  },
    { id: 'r4', org_id: 'ORG002', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'ee2Leve',            operador: 'gt', valor: 30, enabled: false },
  ]

  it('org-default rows resolve to non-null ResolvedUmbrales', () => {
    const resolved = _resolveUmbrales(orgDefaultRows)
    expect(resolved).not.toBeNull()
  })

  it('J (ee3a6Severo) fires at >10 via org-default', () => {
    const resolved = _resolveUmbrales(orgDefaultRows)!
    const umbrales = _toUmbralesSeveridad(resolved)
    expect(11 > umbrales.ee3a6Severo).toBe(true)  // J alert fires
    expect(10 > umbrales.ee3a6Severo).toBe(false) // boundary: exactly 10 = no fire
  })

  it('I (ee2Avanzado) fires at >5 via org-default', () => {
    const resolved = _resolveUmbrales(orgDefaultRows)!
    const umbrales = _toUmbralesSeveridad(resolved)
    expect(6 > umbrales.ee2Avanzado).toBe(true)
    expect(5 > umbrales.ee2Avanzado).toBe(false)
  })

  it('M (hojasFuncionalesMin) fires at <9 via org-default', () => {
    const resolved = _resolveUmbrales(orgDefaultRows)!
    const umbrales = _toUmbralesSeveridad(resolved)
    expect(8 < umbrales.hojasFuncionalesMin).toBe(true)
    expect(9 < umbrales.hojasFuncionalesMin).toBe(false)
  })

  it('H (ee2Leve) does NOT fire (enabled=false → Infinity sentinel)', () => {
    const resolved = _resolveUmbrales(orgDefaultRows)!
    const umbrales = _toUmbralesSeveridad(resolved)
    // enabled=false rows are excluded from resolvedUmbrales → toUmbralesSeveridad uses Infinity
    expect(100 > umbrales.ee2Leve).toBe(false)
  })

  it('empty rows → resolveUmbrales null → EventHandler fail-safe uses UMBRALES_SEVERIDAD_DEFAULT (J/I/M still fire)', () => {
    // Post-cutover: if getUmbralesAlerta returns [] (no rows at all),
    // EventHandler must NOT go silent — it uses UMBRALES_SEVERIDAD_DEFAULT.
    const resolved = _resolveUmbrales([])
    expect(resolved).toBeNull()
    // Fail-safe: EventHandler assigns UMBRALES_SEVERIDAD_DEFAULT when resolved is null.
    // Verify the default values are non-trivial (not silent):
    expect(11 > UMBRALES_SEVERIDAD_DEFAULT.ee3a6Severo).toBe(true)
    expect(6 > UMBRALES_SEVERIDAD_DEFAULT.ee2Avanzado).toBe(true)
    expect(8 < UMBRALES_SEVERIDAD_DEFAULT.hojasFuncionalesMin).toBe(true)
  })
})
