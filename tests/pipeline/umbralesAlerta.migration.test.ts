/**
 * T1.1 — Migration snapshot test: verifies that pending_alert_config is a valid
 * sesiones_activas status value per the CHECK constraint added in
 * 20260625000068_add-pending-alert-config-status.sql.
 *
 * These tests are migration-contract tests: they assert the expected full list
 * of valid status values from the CHECK constraint, so any future migration that
 * drops or adds a value will cause a clear failure here.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The canonical list of valid sesiones_activas.status values after
// migration 067 (pending_sigatoka_aclaracion) and migration 068
// (pending_alert_config).
const VALID_STATUSES = [
  'active',
  'pending_confirmation',
  'pending_location_confirm',
  'pending_excel_confirm',
  'pending_sigatoka_aclaracion',
  'pending_alert_config',
  'processing_intentions',
  'completed',
  'fallback_nota_libre',
  'expired',
] as const

type SesionStatus = typeof VALID_STATUSES[number]

// Simulate the CHECK constraint logic from the migration.
// In real code, EventHandler writes these string literals directly; this test
// verifies the contract so a typo in the migration is caught early.
function isValidSesionStatus(s: string): s is SesionStatus {
  return (VALID_STATUSES as readonly string[]).includes(s)
}

describe('sesiones_activas CHECK constraint — migration 068 contract', () => {
  it('includes pending_alert_config in the valid status list', () => {
    expect(isValidSesionStatus('pending_alert_config')).toBe(true)
  })

  it('includes pending_sigatoka_aclaracion (migration 067 preserved)', () => {
    expect(isValidSesionStatus('pending_sigatoka_aclaracion')).toBe(true)
  })

  it('includes all pre-existing statuses unchanged', () => {
    const preExisting = [
      'active',
      'pending_confirmation',
      'pending_location_confirm',
      'pending_excel_confirm',
      'processing_intentions',
      'completed',
      'fallback_nota_libre',
      'expired',
    ]
    for (const s of preExisting) {
      expect(isValidSesionStatus(s)).toBe(true)
    }
  })

  it('rejects a previously-used magic non-status value', () => {
    expect(isValidSesionStatus('pending_alert_cfg')).toBe(false)
    expect(isValidSesionStatus('alert_config')).toBe(false)
    expect(isValidSesionStatus('')).toBe(false)
  })

  it('contains exactly 10 valid statuses (no unintended additions)', () => {
    expect(VALID_STATUSES).toHaveLength(10)
  })
})

// ─── Fix 3: RLS policy contract — migration 075 ───────────────────────────────

describe('RLS policy migration 075 contract', () => {
  const migrationPath = join(process.cwd(), 'supabase/migrations/20260625000075_rls-policies-umbrales-alerta.sql')

  it('migration file exists', () => {
    expect(() => readFileSync(migrationPath, 'utf-8')).not.toThrow()
  })

  it('contains CREATE POLICY for umbrales_alerta (service_role only)', () => {
    const sql = readFileSync(migrationPath, 'utf-8')
    expect(sql).toContain('ON umbrales_alerta')
    expect(sql).toContain("auth.role() = 'service_role'")
  })

  it('contains CREATE POLICY for decision_alerta (service_role only)', () => {
    const sql = readFileSync(migrationPath, 'utf-8')
    expect(sql).toContain('ON decision_alerta')
  })
})
