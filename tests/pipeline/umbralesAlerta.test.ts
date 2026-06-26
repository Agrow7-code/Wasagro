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
  fireAlerts,
  PEST_ALERT_FIELDS,
  type UmbralAlertaRow,
  type ResolvedUmbrales,
  type FiredAlert,
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

// ─── T2.1 fireAlerts ─────────────────────────────────────────────────────────

describe('fireAlerts', () => {
  const makeResolved = (overrides: Partial<ResolvedUmbrales> = {}): ResolvedUmbrales => ({
    ee3a6Severo: { campo: 'ee3a6Severo', operador: 'gt', valor: 10, source: 'org' },
    hojasFuncionalesMin: { campo: 'hojasFuncionalesMin', operador: 'lt', valor: 9, source: 'org' },
    ...overrides,
  })

  it('fires when campo value exceeds gt rule', () => {
    const resolved = makeResolved()
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { ee3a6Severo: 15 } })
    expect(alerts.some(a => a.campo === 'ee3a6Severo')).toBe(true)
  })

  it('fires when value is below lt rule', () => {
    const resolved = makeResolved()
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { hojasFuncionalesMin: 7 } })
    expect(alerts.some(a => a.campo === 'hojasFuncionalesMin')).toBe(true)
  })

  it('does not fire when value is below gt threshold', () => {
    const resolved = makeResolved()
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { ee3a6Severo: 5 } })
    expect(alerts.some(a => a.campo === 'ee3a6Severo')).toBe(false)
  })

  it('does not fire when value is above lt threshold', () => {
    const resolved = makeResolved()
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { hojasFuncionalesMin: 12 } })
    expect(alerts.some(a => a.campo === 'hojasFuncionalesMin')).toBe(false)
  })

  it('does not fire for a campo not in observations', () => {
    const resolved = makeResolved()
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: {} })
    expect(alerts).toHaveLength(0)
  })

  it('gte fires when value equals threshold', () => {
    const resolved: ResolvedUmbrales = {
      pct_afectado: { campo: 'pct_afectado', operador: 'gte', valor: 20, source: 'org' },
    }
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'moniliasis', observations: { pct_afectado: 20 } })
    expect(alerts.some(a => a.campo === 'pct_afectado')).toBe(true)
  })

  it('gt does not fire when value equals threshold (strict)', () => {
    const resolved: ResolvedUmbrales = {
      ee3a6Severo: { campo: 'ee3a6Severo', operador: 'gt', valor: 10, source: 'org' },
    }
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { ee3a6Severo: 10 } })
    expect(alerts.some(a => a.campo === 'ee3a6Severo')).toBe(false)
  })

  it('lte fires when value equals threshold', () => {
    const resolved: ResolvedUmbrales = {
      hojasFuncionalesMin: { campo: 'hojasFuncionalesMin', operador: 'lte', valor: 9, source: 'org' },
    }
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: { hojasFuncionalesMin: 9 } })
    expect(alerts.some(a => a.campo === 'hojasFuncionalesMin')).toBe(true)
  })

  it('returns FiredAlert with finca_id, pest_type, campo, value, threshold', () => {
    const resolved: ResolvedUmbrales = {
      pct_afectado: { campo: 'pct_afectado', operador: 'gt', valor: 20, source: 'org' },
    }
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'moniliasis', observations: { pct_afectado: 25 } })
    expect(alerts).toHaveLength(1)
    const alert = alerts[0] as FiredAlert
    expect(alert.finca_id).toBe('F001')
    expect(alert.pest_type).toBe('moniliasis')
    expect(alert.campo).toBe('pct_afectado')
    expect(alert.value).toBe(25)
    expect(alert.threshold).toBe(20)
  })

  it('empty resolved → no fires', () => {
    const alerts = fireAlerts({}, { finca_id: 'F001', pest_type: 'moniliasis', observations: { pct_afectado: 99 } })
    expect(alerts).toHaveLength(0)
  })

  it('Sigatoka peorJ/I/H/M shape maps correctly via extractObservation sourceKeys', () => {
    // Sigatoka uses peorJ as a sourceKey for ee3a6Severo
    const campos = extractObservation('sigatoka_negra', { peorJ: 15, peorI: 7, peorM: 6 })
    const resolved: ResolvedUmbrales = {
      ee3a6Severo: { campo: 'ee3a6Severo', operador: 'gt', valor: 10, source: 'org' },
      ee2Avanzado: { campo: 'ee2Avanzado', operador: 'gt', valor: 5, source: 'org' },
      hojasFuncionalesMin: { campo: 'hojasFuncionalesMin', operador: 'lt', valor: 9, source: 'org' },
    }
    const alerts = fireAlerts(resolved, { finca_id: 'F001', pest_type: 'sigatoka_negra', observations: campos })
    const alertCampos = alerts.map(a => a.campo)
    expect(alertCampos).toContain('ee3a6Severo')
    expect(alertCampos).toContain('ee2Avanzado')
    expect(alertCampos).toContain('hojasFuncionalesMin')
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
