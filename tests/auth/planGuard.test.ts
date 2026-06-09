import { describe, it, expect, vi } from 'vitest'

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
      fincas_contratadas: 1,
      usuarios_contratados: 1,
      precio_mensual: null,
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
    })
    expect(allowed).toBe(true)
  })
})

describe('isOrgBillingActive — standard logic when is_test_org=false', () => {
  it('trial dentro de la ventana → active', () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: future, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
    })).toBe(true)
  })

  it('trial expirado → inactive', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: past, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
    })).toBe(false)
  })

  it('trial sin trial_fin → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'trial', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
    })).toBe(false)
  })

  it('agricultor con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'agricultor', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: 22,
    })).toBe(true)
  })

  it('productor con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'productor', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 3, usuarios_contratados: 5, precio_mensual: 59,
    })).toBe(true)
  })

  it('pyme con subscription past_due → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'pyme', trial_fin: null, subscription_status: 'past_due', is_test_org: false,
      fincas_contratadas: 10, usuarios_contratados: 12, precio_mensual: 153,
    })).toBe(false)
  })

  it('corporativo con subscription canceled → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'corporativo', trial_fin: null, subscription_status: 'canceled', is_test_org: false,
      fincas_contratadas: 50, usuarios_contratados: 50, precio_mensual: 650,
    })).toBe(false)
  })

  it('plan=free sin override → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'free', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
    })).toBe(false)
  })

  it('starter (legado) con subscription active → active', () => {
    expect(isOrgBillingActive({
      plan: 'starter', trial_fin: null, subscription_status: 'active', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: 29,
    })).toBe(true)
  })

  it('enterprise (legado) con subscription past_due → inactive', () => {
    expect(isOrgBillingActive({
      plan: 'enterprise', trial_fin: null, subscription_status: 'past_due', is_test_org: false,
      fincas_contratadas: 10, usuarios_contratados: 12, precio_mensual: 79,
    })).toBe(false)
  })
})
