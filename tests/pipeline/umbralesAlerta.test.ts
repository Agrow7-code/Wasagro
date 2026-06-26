/**
 * T1.9 — Unit tests for the pure domain logic in umbralesAlerta.ts.
 * These tests are written FIRST (TDD RED phase); they will fail until T1.10 is implemented.
 * No I/O. No mocks needed — all functions are pure.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  canonicalPestType,
  extractObservation,
  resolveUmbrales,
  toUmbralesSeveridad,
  PEST_ALERT_FIELDS,
  type UmbralAlertaRow,
} from '../../src/pipeline/handlers/umbralesAlerta.js'

// ─── canonicalPestType ────────────────────────────────────────────────────────

describe('canonicalPestType', () => {
  it('converts Sigatoka negra to sigatoka_negra', () => {
    expect(canonicalPestType('Sigatoka negra')).toBe('sigatoka_negra')
  })

  it('converts Moniliasis to moniliasis', () => {
    expect(canonicalPestType('Moniliasis')).toBe('moniliasis')
  })

  it('converts Trips de la mancha roja to trips_de_la_mancha_roja', () => {
    expect(canonicalPestType('Trips de la mancha roja')).toBe('trips_de_la_mancha_roja')
  })

  it('handles already-lower-snake case passthrough', () => {
    expect(canonicalPestType('sigatoka_negra')).toBe('sigatoka_negra')
  })

  it('trims extra whitespace', () => {
    expect(canonicalPestType('  Moniliasis  ')).toBe('moniliasis')
  })
})

// ─── extractObservation ───────────────────────────────────────────────────────

describe('extractObservation', () => {
  it('maps Moniliasis pct_afectado key to pct_afectado campo', () => {
    const result = extractObservation('moniliasis', { pct_afectado: 22 })
    expect(result).toEqual({ pct_afectado: 22 })
  })

  it('maps Moniliasis incidencia key to pct_afectado campo (alias)', () => {
    const result = extractObservation('moniliasis', { incidencia: 15 })
    expect(result).toEqual({ pct_afectado: 15 })
  })

  it('returns undefined for a key not in the catalog (no silent crash, P4)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = extractObservation('moniliasis', { unknown_key: 99 })
    expect(result).toEqual({})
    warnSpy.mockRestore()
  })

  it('returns empty object for unknown pest type', () => {
    const result = extractObservation('some_unknown_pest', { valor: 5 })
    expect(result).toEqual({})
  })
})

// ─── resolveUmbrales ─────────────────────────────────────────────────────────

const makeRow = (overrides: Partial<UmbralAlertaRow>): UmbralAlertaRow => ({
  id: 'test-id',
  org_id: 'ORG001',
  finca_id: null,
  finca_scope: '*',
  pest_type: 'sigatoka_negra',
  campo: 'ee3a6Severo',
  operador: 'gt',
  valor: 10,
  enabled: true,
  ...overrides,
})

describe('resolveUmbrales', () => {
  it('per-finca row wins over org default for the same campo', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ finca_id: null, finca_scope: '*', campo: 'ee3a6Severo', valor: 10 }),
      makeRow({ finca_id: 'F001', finca_scope: 'F001', campo: 'ee3a6Severo', valor: 15 }),
    ]
    const result = resolveUmbrales(rows)
    expect(result).not.toBeNull()
    expect(result!['ee3a6Severo']?.valor).toBe(15)
  })

  it('org default applies when no per-finca row exists', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ finca_id: null, finca_scope: '*', campo: 'ee3a6Severo', valor: 10 }),
    ]
    const result = resolveUmbrales(rows)
    expect(result).not.toBeNull()
    expect(result!['ee3a6Severo']?.valor).toBe(10)
  })

  it('returns null when no rows provided', () => {
    expect(resolveUmbrales([])).toBeNull()
  })

  it('excludes enabled=false rows from the resolved result', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee2Leve', valor: 30, enabled: false }),
    ]
    const result = resolveUmbrales(rows)
    // All rows are disabled, so the result should be null or not contain ee2Leve as active
    expect(result === null || result['ee2Leve'] === undefined).toBe(true)
  })

  it('returns null when all rows are disabled', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', enabled: false }),
      makeRow({ campo: 'ee2Avanzado', enabled: false }),
    ]
    expect(resolveUmbrales(rows)).toBeNull()
  })

  it('skips a malformed row (non-numeric valor) and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', valor: NaN }),
    ]
    const result = resolveUmbrales(rows)
    expect(result === null || result['ee3a6Severo'] === undefined).toBe(true)
    warnSpy.mockRestore()
  })
})

// ─── toUmbralesSeveridad ──────────────────────────────────────────────────────

describe('toUmbralesSeveridad', () => {
  it('maps a fully resolved gt row to its numeric value for ee3a6Severo', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', operador: 'gt', valor: 12, enabled: true }),
      makeRow({ campo: 'ee2Avanzado', operador: 'gt', valor: 6, enabled: true }),
      makeRow({ campo: 'hojasFuncionalesMin', operador: 'lt', valor: 8, enabled: true }),
      makeRow({ campo: 'ee2Leve', operador: 'gt', valor: 30, enabled: true }),
    ]
    const resolved = resolveUmbrales(rows)!
    const umb = toUmbralesSeveridad(resolved)
    expect(umb.ee3a6Severo).toBe(12)
    expect(umb.ee2Avanzado).toBe(6)
    expect(umb.hojasFuncionalesMin).toBe(8)
    expect(umb.ee2Leve).toBe(30)
  })

  it('gt field with no enabled rule → Infinity (never fires)', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', operador: 'gt', valor: 10, enabled: true }),
      // ee2Avanzado is absent
    ]
    const resolved = resolveUmbrales(rows)!
    const umb = toUmbralesSeveridad(resolved)
    expect(umb.ee2Avanzado).toBe(Infinity)
  })

  it('lt field with no enabled rule → -Infinity (never fires)', () => {
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', operador: 'gt', valor: 10, enabled: true }),
      // hojasFuncionalesMin is absent
    ]
    const resolved = resolveUmbrales(rows)!
    const umb = toUmbralesSeveridad(resolved)
    expect(umb.hojasFuncionalesMin).toBe(-Infinity)
  })

  it('enabled=false row → Infinity for gt field (silence)', () => {
    // ee2Leve is disabled by default
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', operador: 'gt', valor: 10, enabled: true }),
      makeRow({ campo: 'ee2Leve', operador: 'gt', valor: 30, enabled: false }),
    ]
    // resolveUmbrales excludes disabled rows, so ee2Leve won't be in resolved
    const resolved = resolveUmbrales(rows)!
    const umb = toUmbralesSeveridad(resolved)
    expect(umb.ee2Leve).toBe(Infinity)
  })

  it('never returns a hardcoded numeric default — only values from resolved or ±Infinity', () => {
    // If we pass an empty resolved (all disabled), toUmbralesSeveridad should use sentinels
    // We test this by passing a resolved with just one campo
    const rows: UmbralAlertaRow[] = [
      makeRow({ campo: 'ee3a6Severo', operador: 'gt', valor: 10, enabled: true }),
    ]
    const resolved = resolveUmbrales(rows)!
    const umb = toUmbralesSeveridad(resolved)
    // Only ee3a6Severo should be numeric; rest should be sentinels
    expect(Number.isFinite(umb.ee3a6Severo)).toBe(true)
    expect(umb.ee2Avanzado).toBe(Infinity)
    expect(umb.hojasFuncionalesMin).toBe(-Infinity)
    expect(umb.ee2Leve).toBe(Infinity)
  })
})

// ─── PEST_ALERT_FIELDS catalog ────────────────────────────────────────────────

describe('PEST_ALERT_FIELDS catalog', () => {
  it('has entries for sigatoka_negra and moniliasis', () => {
    expect(PEST_ALERT_FIELDS['sigatoka_negra']).toBeDefined()
    expect(PEST_ALERT_FIELDS['moniliasis']).toBeDefined()
  })

  it('sigatoka_negra has exactly 4 campos', () => {
    expect(PEST_ALERT_FIELDS['sigatoka_negra']).toHaveLength(4)
  })

  it('moniliasis pct_afectado sourceKeys includes incidencia alias', () => {
    const field = PEST_ALERT_FIELDS['moniliasis']?.find(f => f.campo === 'pct_afectado')
    expect(field?.sourceKeys).toContain('incidencia')
    expect(field?.sourceKeys).toContain('pct_afectado')
  })
})
