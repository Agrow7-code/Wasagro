import type { Context, Next } from 'hono'
import { verificarJWT } from '../auth/jwtService.js'
import type { WasagroJWTPayload } from '../auth/jwtService.js'
import { createUserScopedClient } from '../integrations/supabase.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthedUser {
  id: string
  phone: string
  rol: string
  finca_id: string | null
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

export function requireFincaAccess(c: Context, requestedFincaId: string): boolean {
  const user = c.get('authedUser')
  if (!user) return false
  if (user.rol === 'admin_org' || user.rol === 'director') return true
  return user.finca_id === requestedFincaId
}

export function getUserSupabase(c: Context): SupabaseClient | null {
  return c.get('userSupabase') ?? null
}
