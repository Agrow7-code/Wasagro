import type { Context, Next } from 'hono'
import { supabase } from '../integrations/supabase.js'
import type { AuthedUser } from '../auth/middleware.js'
import { isPaidPlan } from './pricingUtils.js'

// Grace window for provisioned-but-not-onboarded orgs (trial_fin=null).
// Configurable via env PROVISION_GRACE_DAYS; default 7.
// After this window the org is blocked until the admin completes onboarding
// (which sets trial_inicio → trigger computes trial_fin → normal 30d applies).
function getProvisionGraceDays(): number {
  const raw = process.env['PROVISION_GRACE_DAYS']
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7
}

interface OrgBillingState {
  plan: string
  trial_fin: string | null
  subscription_status: string
  is_test_org: boolean
  fincas_contratadas: number
  usuarios_contratados: number
  precio_mensual: number | null
  created_at: string
}

async function getOrgBillingState(orgId: string): Promise<OrgBillingState | null> {
  const { data, error } = await supabase
    .from('organizaciones')
    .select('plan, trial_fin, subscription_status, is_test_org, fincas_contratadas, usuarios_contratados, precio_mensual, created_at')
    .eq('org_id', orgId)
    .single()

  if (error || !data) return null
  return data as OrgBillingState
}

export function isOrgBillingActive(state: OrgBillingState): boolean {
  if (state.is_test_org) return true
  if (state.plan === 'trial') {
    if (state.trial_fin === null) {
      // trial_fin=null → deferred trial: trial_inicio not yet set (onboarding pending).
      // Grant access only within the provision grace window from created_at.
      // This prevents permanently-open orgs for accounts that never onboard.
      const graceDays = getProvisionGraceDays()
      const graceMs = graceDays * 24 * 60 * 60 * 1000
      const createdAt = new Date(state.created_at).getTime()
      return Date.now() - createdAt < graceMs
    }
    return new Date(state.trial_fin) > new Date()
  }
  if (isPaidPlan(state.plan)) {
    return state.subscription_status === 'active'
  }
  return false
}

export async function planGuard(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('authedUser') as AuthedUser | undefined
  if (!user) {
    return c.json({ error: 'No autenticado' }, 401)
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!usuario?.org_id) {
    return c.json({ error: 'Usuario sin organización' }, 403)
  }

  const state = await getOrgBillingState(usuario.org_id)
  if (!state) {
    return c.json({ error: 'Organización no encontrada' }, 404)
  }

  if (!isOrgBillingActive(state)) {
    return c.json(
      {
        error: 'Suscripción inactiva',
        plan: state.plan,
        trial_fin: state.trial_fin,
        subscription_status: state.subscription_status,
        upgrade_required: true,
      },
      402
    )
  }

  c.set('orgId', usuario.org_id)
  await next()
}

export async function planGuardWhatsApp(orgId: string): Promise<{ allowed: boolean; state: OrgBillingState }> {
  const state = await getOrgBillingState(orgId)
  if (!state) return {
    allowed: false,
    state: {
      plan: 'free', trial_fin: null, subscription_status: 'none', is_test_org: false,
      fincas_contratadas: 1, usuarios_contratados: 1, precio_mensual: null,
      created_at: new Date().toISOString(),
    },
  }
  return { allowed: isOrgBillingActive(state), state }
}
