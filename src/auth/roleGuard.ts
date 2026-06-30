import type { Context, Next } from 'hono'

/**
 * Director-only gate for `/api/admin/*` (D28). This is the SOLE thing standing
 * between the public internet and service_role cross-org reads — see
 * design.md §1 ("roleGuard — fail-closed, the sole gate to service_role
 * cross-org data").
 *
 * Fail-closed contract:
 * - missing/malformed `authedUser`, or `rol` not a string  → 403
 * - `rol !== 'director'`                                    → 403
 * - ANY thrown exception (including from `next()`)          → 500, and
 *   `next()` is NEVER called again from inside the catch.
 */
export async function roleGuard(c: Context, next: Next): Promise<Response | void> {
  try {
    const user = c.get('authedUser')
    if (!user || typeof user.rol !== 'string') return c.json({ error: 'Forbidden' }, 403)
    if (user.rol !== 'director') return c.json({ error: 'Forbidden' }, 403)
    await next()
  } catch {
    // Fail-closed: never call next() from inside a catch.
    return c.json({ error: 'Internal error' }, 500)
  }
}
