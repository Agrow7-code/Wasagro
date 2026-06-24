import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
  createSupabaseClient: vi.fn(),
}))

import { isOrgBillingActive } from '../../src/auth/planGuard.js'

// ─── Deferred trial with grace-window (Fix 2 — grace bound replaces permanent NULL=active) ─
// After migration 062, provisioned orgs have trial_fin=NULL until onboarding completes.
// planGuard grants access during a PROVISION_GRACE_DAYS window (default 7) from created_at.
// Once trial_inicio is set (onboarding done), trial_fin governs as before (30d).
//
// OrgBillingState now includes created_at so the grace-window can be evaluated.
describe('isOrgBillingActive — deferred trial grace window (NULL trial_fin)', () => {
  const graceMs = 7 * 24 * 60 * 60 * 1000 // 7 days default

  it('plan=trial, trial_fin=null, created_at=now → active (within grace window)', () => {
    const createdAt = new Date().toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: createdAt,
    })).toBe(true)
  })

  it('plan=trial, trial_fin=null, created_at=6d ago → active (still within 7d grace)', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: sixDaysAgo,
    })).toBe(true)
  })

  it('plan=trial, trial_fin=null, created_at=8d ago → inactive (past 7d grace)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: eightDaysAgo,
    })).toBe(false)
  })

  it('plan=trial, trial_fin=null, created_at=60d ago → inactive (long after grace)', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: sixtyDaysAgo,
    })).toBe(false)
  })

  it('plan=trial, trial_fin=future (post-onboarding) → active regardless of created_at', () => {
    // Once trial_inicio was set, trial_fin governs. Grace window is irrelevant.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: future, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: thirtyDaysAgo,
    })).toBe(true)
  })

  it('plan=trial, trial_fin=past (post-onboarding, expired) → inactive', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: yesterday, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: recent,
    })).toBe(false)
  })

  it('clock-edge: created_at exactly at grace boundary is inactive (not strictly within)', () => {
    // Edge: exactly PROVISION_GRACE_DAYS days ago. The comparison is strict <,
    // so the edge moment itself is inactive.
    const exactGraceAgo = new Date(Date.now() - graceMs).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: exactGraceAgo,
    })).toBe(false)
  })
})

describe('isOrgBillingActive — is_test_org override', () => {
  const recentDate = new Date().toISOString()

  it('is_test_org=true → always active, even with trial expired', () => {
    const expired = new Date(Date.now() - 86400000).toISOString()
    const allowed = isOrgBillingActive({
      plan: 'trial',
      trial_fin: expired,
      subscription_status: 'none',
      is_test_org: true,
      fincas_contratadas: 1,
      usuarios_contratados: 1,
      precio_mensual: null,
      created_at: recentDate,
    })
    expect(allowed).toBe(true)
  })

  it('is_test_org=true → always active, even with subscription canceled', () => {
    const allowed = isOrgBillingActive({
      plan: 'pyme',
      trial_fin: null,
      subscription_status: 'canceled',
      is_test_org: true,
      fincas_contratadas: 10,
      usuarios_contratados: 12,
      precio_mensual: 153,
      created_at: recentDate,
    })
    expect(allowed).toBe(true)
  })

  it('is_test_org=true → always active, even on plan=free', () => {
    const allowed = isOrgBillingActive({
      plan: 'free',
      trial_fin: null,
      subscription_status: 'none',
      is_test_org: true,
      fincas_contratadas: 1,
      usuarios_contratados: 1,
      precio_mensual: null,
      created_at: recentDate,
    })
    expect(allowed).toBe(true)
  })
})

describe('isOrgBillingActive — standard logic when is_test_org=false', () => {
  const recentDate = new Date().toISOString()

  it('trial dentro de la ventana → active', () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: future, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: recentDate,
    })).toBe(true)
  })

  it('trial expirado → inactive', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: past, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: recentDate,
    })).toBe(false)
  })

  // Pre-deferred-trial behaviour: trial_fin=null was "inactive". That semantic no longer applies
  // after migration 062: trial_fin=null now means "provisioned, onboarding pending → active"
  // within the grace window. Replaced by the deferred-trial grace-window describe block above.

  it('agricultor con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'agricultor', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: 22,
      created_at: recentDate,
    })).toBe(true)
  })

  it('productor con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'productor', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 3, usuarios_contratados: 5, precio_mensual: 59,
      created_at: recentDate,
    })).toBe(true)
  })

  it('pyme con subscription past_due → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'pyme', trial_fin: null, subscription_status: 'past_due', is_test_org: false,
      fincas_contratadas: 10, usuarios_contratados: 12, precio_mensual: 153,
      created_at: recentDate,
    })).toBe(false)
  })

  it('corporativo con subscription canceled → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'corporativo', trial_fin: null, subscription_status: 'canceled', is_test_org: false,
      fincas_contratadas: 50, usuarios_contratados: 50, precio_mensual: 650,
      created_at: recentDate,
    })).toBe(false)
  })

  it('plan=free sin override → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'free', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: recentDate,
    })).toBe(false)
  })

  it('starter (legado) con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'starter', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: 29,
      created_at: recentDate,
    })).toBe(true)
  })

  it('enterprise (legado) con subscription past_due → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'enterprise', trial_fin: null, subscription_status: 'past_due', is_test_org: false,
      fincas_contratadas: 10, usuarios_contratados: 12, precio_mensual: 79,
      created_at: recentDate,
    })).toBe(false)
  })
})
