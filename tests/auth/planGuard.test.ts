// is_test_org bypass — protege a las orgs internas (ORG001, futuras) de
// cualquier proceso de billing que normalice el plan. Migration 52 añadió
// la columna; planGuard la lee como override de la lógica de
// trial/subscription_status.

import { describe, it, expect, vi } from 'vitest'

// planGuard imports supabase which requires SUPABASE_URL at module-load. The
// helper under test (isOrgBillingActive) is a pure function and doesn't use
// supabase, but the import path crosses through, so we mock the client.
vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
  createSupabaseClient: vi.fn(),
}))

import { isOrgBillingActive } from '../../src/auth/planGuard.js'

describe('isOrgBillingActive — is_test_org override', () => {
  it('is_test_org=true → always active, even with trial expired', () => {
    const expired = new Date(Date.now() - 86400000).toISOString()
    const allowed = isOrgBillingActive({
      plan: 'trial',
      trial_fin: expired,
      subscription_status: 'none',
      is_test_org: true,
    })
    expect(allowed).toBe(true)
  })

  it('is_test_org=true → always active, even with subscription canceled', () => {
    const allowed = isOrgBillingActive({
      plan: 'enterprise',
      trial_fin: null,
      subscription_status: 'canceled',
      is_test_org: true,
    })
    expect(allowed).toBe(true)
  })

  it('is_test_org=true → always active, even on plan=free', () => {
    const allowed = isOrgBillingActive({
      plan: 'free',
      trial_fin: null,
      subscription_status: 'none',
      is_test_org: true,
    })
    expect(allowed).toBe(true)
  })
})

describe('isOrgBillingActive — standard logic when is_test_org=false', () => {
  it('trial dentro de la ventana → active', () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: future, subscription_status: 'none', is_test_org: false,
    })).toBe(true)
  })

  it('trial expirado → inactive', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: past, subscription_status: 'none', is_test_org: false,
    })).toBe(false)
  })

  it('trial sin trial_fin → inactive (guard contra mala data)', () => {
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
    })).toBe(false)
  })

  it('starter con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'starter', trial_fin: null, subscription_status: 'active', is_test_org: false,
    })).toBe(true)
  })

  it('enterprise con subscription past_due → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'enterprise', trial_fin: null, subscription_status: 'past_due', is_test_org: false,
    })).toBe(false)
  })

  it('enterprise con subscription canceled → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'enterprise', trial_fin: null, subscription_status: 'canceled', is_test_org: false,
    })).toBe(false)
  })

  it('plan=free sin override → inactive (los free son orgs post-trial bloqueadas)', () => {
    expect(isOrgBillingActive({
      plan: 'free', trial_fin: null, subscription_status: 'none', is_test_org: false,
    })).toBe(false)
  })
})
