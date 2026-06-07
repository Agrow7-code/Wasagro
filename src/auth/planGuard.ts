import type { Context, Next } from 'hono'
import { supabase } from '../integrations/supabase.js'
import type { AuthedUser } from '../auth/middleware.js'

interface OrgBillingState {
  plan: string
  trial_fin: string | null
  subscription_status: string
  is_test_org: boolean
}

async function getOrgBillingState(orgId: string): Promise<OrgBillingState | null> {
  const { data, error } = await supabase
    .from('organizaciones')
    .select('plan, trial_fin, subscription_status, is_test_org')
    .eq('org_id', orgId)
    .single()

  if (error || !data) return null
  return data as OrgBillingState
}

// `is_test_org` short-circuits TODA la verificación de billing — las orgs
// internas de pruebas (ej. ORG001) deben permanecer activas independiente del
// plan/trial/subscription_status para no bloquear QA y demos. Migration 52
// añadió el flag; ORG001 quedó marcada como is_test_org=true ahí mismo.
// Cualquier job de billing reconciliation futuro debe excluir is_test_org=true
// en sus UPDATE bulk para no pisar este setup.
export function isOrgBillingActive(state: OrgBillingState): boolean {
  if (state.is_test_org) return true
  if (state.plan === 'trial') {
    return state.trial_fin !== null && new Date(state.trial_fin) > new Date()
  }
  if (state.plan === 'starter' || state.plan === 'enterprise') {
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
  if (!state) return { allowed: false, state: { plan: 'free', trial_fin: null, subscription_status: 'none', is_test_org: false } }
  return { allowed: isOrgBillingActive(state), state }
}
