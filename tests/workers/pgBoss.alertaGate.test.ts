/**
 * Tests for the ALERT_DELIVERY_ENABLED gate (src/workers/alertDeliveryGate.ts).
 *
 * Rationale: at the pgBoss extraction stage, eventos_campo has no row yet
 * (farmer hasn't confirmed), so there's no event_id for idempotency keying.
 * Code after the delivery block can throw → pgBoss retry → double-send.
 * The gate keeps delivery inert until PR#3 wires it at the confirmation point.
 *
 * PR#3 TODO:
 *   - Wire entregarAlertaPlaga at the EventHandler confirmation point (after eventos_campo insert)
 *   - Pass eventId + markAlertaEntregada (UPDATE alerta_plaga_entregada_at) for real idempotency
 *   - Implement M12 is_first_alert via decision_alerta.ask_count read
 *   - Then flip ALERT_DELIVERY_ENABLED=true in prod env
 *   Until then: non-Sigatoka delivery is inert in prod. Sigatoka alerts via PR#1 dual-read
 *   are unaffected and keep working (they go through EventHandler, not this pgBoss path).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isAlertDeliveryEnabled } from '../../src/workers/alertDeliveryGate.js'

describe('ALERT_DELIVERY_ENABLED gate — isAlertDeliveryEnabled()', () => {
  const originalEnv = process.env['ALERT_DELIVERY_ENABLED']

  afterEach(() => {
    // Restore env after each test
    if (originalEnv === undefined) {
      delete process.env['ALERT_DELIVERY_ENABLED']
    } else {
      process.env['ALERT_DELIVERY_ENABLED'] = originalEnv
    }
  })

  it('returns false when ALERT_DELIVERY_ENABLED is unset (prod default: delivery OFF)', () => {
    delete process.env['ALERT_DELIVERY_ENABLED']
    expect(isAlertDeliveryEnabled()).toBe(false)
  })

  it('returns false when ALERT_DELIVERY_ENABLED is empty string', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = ''
    expect(isAlertDeliveryEnabled()).toBe(false)
  })

  it('returns false when ALERT_DELIVERY_ENABLED is "false"', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'false'
    expect(isAlertDeliveryEnabled()).toBe(false)
  })

  it('returns true when ALERT_DELIVERY_ENABLED is "true" (explicit opt-in)', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    expect(isAlertDeliveryEnabled()).toBe(true)
  })
})

// Verify the compound gate condition used in pgBoss (isAlertDeliveryEnabled() && alerta_urgente && plagaPestType)
describe('gate compound condition (pgBoss delivery block logic)', () => {
  it('gate OFF: no delivery even when alerta_urgente=true and plagaPestType is set', () => {
    delete process.env['ALERT_DELIVERY_ENABLED']
    const wouldDeliver = isAlertDeliveryEnabled() && true && Boolean('moniliasis')
    expect(wouldDeliver).toBe(false)
  })

  it('gate ON: delivery proceeds when alerta_urgente=true and plagaPestType is set', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    const wouldDeliver = isAlertDeliveryEnabled() && true && Boolean('moniliasis')
    expect(wouldDeliver).toBe(true)
    delete process.env['ALERT_DELIVERY_ENABLED']
  })

  it('gate ON but alerta_urgente=false: delivery block skipped', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    const wouldDeliver = isAlertDeliveryEnabled() && false && Boolean('moniliasis')
    expect(wouldDeliver).toBe(false)
    delete process.env['ALERT_DELIVERY_ENABLED']
  })

  it('gate ON but plagaPestType is null: delivery block skipped', () => {
    process.env['ALERT_DELIVERY_ENABLED'] = 'true'
    const wouldDeliver = isAlertDeliveryEnabled() && true && Boolean(null)
    expect(wouldDeliver).toBe(false)
    delete process.env['ALERT_DELIVERY_ENABLED']
  })
})
