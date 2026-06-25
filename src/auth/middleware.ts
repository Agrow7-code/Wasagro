import type { Context, Next } from 'hono'
import { verificarJWT } from '../auth/jwtService.js'
import type { WasagroJWTPayload } from '../auth/jwtService.js'
import { createUserScopedClient, supabase } from '../integrations/supabase.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthedUser {
  id: string
  phone: string
  rol: string
  finca_id: string | null
  org_id: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    authedUser: AuthedUser
    userSupabase: SupabaseClient
    orgId: string
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Token requerido' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const payload: WasagroJWTPayload = await verificarJWT(token)
    c.set('authedUser', {
      id: payload.sub,
      phone: payload.phone,
      rol: payload.rol,
      finca_id: payload.finca_id,
      org_id: payload.org_id ?? null,
    })

    try {
      c.set('userSupabase', createUserScopedClient(token))
    } catch {
      // If SUPABASE_ANON_KEY is not configured, fall back to service_role
      // This allows gradual rollout of user-scoped access
    }

    await next()
  } catch {
    return c.json({ error: 'Token inválido o expirado' }, 401)
  }
}

// Versión síncrona — solo segura para 'director' (rol interno/back-office global)
// y para el dueño directo de la finca. NO concede acceso amplio a 'admin_org'
// porque eso permitiría cruzar organizaciones; usar requireFincaAccessAsync.
export function requireFincaAccess(c: Context, requestedFincaId: string): boolean {
  const user = c.get('authedUser')
  if (!user) return false
  if (user.rol === 'director') return true
  return user.finca_id === requestedFincaId
}

// Resuelve el org_id de una finca para validar pertenencia (cache simple por request).
async function fincaPerteneceAOrg(fincaId: string, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('fincas')
    .select('org_id')
    .eq('finca_id', fincaId)
    .single()
  return data?.org_id === orgId
}

// Versión async con aislamiento por organización (cierra el hueco cross-tenant):
// - 'director': acceso global (back-office interno, P7/D28).
// - dueño directo de la finca: acceso.
// - 'admin_org': solo fincas de SU organización (verificado contra la DB).
export async function requireFincaAccessAsync(c: Context, requestedFincaId: string): Promise<boolean> {
  const user = c.get('authedUser')
  if (!user) return false
  if (user.rol === 'director') return true
  if (user.finca_id === requestedFincaId) return true
  if (user.rol === 'admin_org' && user.org_id) {
    return fincaPerteneceAOrg(requestedFincaId, user.org_id)
  }
  return false
}

export function getUserSupabase(c: Context): SupabaseClient | null {
  return c.get('userSupabase') ?? null
}

/**
 * T1.16 — Org-level access guard for GET/PUT /api/org/:orgId/alertas/config.
 * Closes the D31 cross-tenant hole for org-scoped endpoints (H7, design §8).
 *   - 'director': global access (back-office internal).
 *   - 'admin_org': only their own org_id.
 *   - All other roles: denied (propietario/agricultor have no org-level config access).
 *   - Unauthenticated (no authedUser): returns false → caller returns 401.
 */
export async function requireOrgAccessAsync(c: Context, requestedOrgId: string): Promise<boolean> {
  const user = c.get('authedUser')
  if (!user) return false
  if (user.rol === 'director') return true
  if (user.rol === 'admin_org') return user.org_id === requestedOrgId
  return false
}
