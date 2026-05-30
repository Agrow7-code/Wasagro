import type { Context, Next } from 'hono'
import { supabase } from '../integrations/supabase.js'

interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  prefix?: string
  key?: (c: Context) => string
}

function extractIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for') ?? ''
  const first = xff.split(',')[0]?.trim()
  if (first) return first
  return c.req.header('x-real-ip') ?? 'unknown'
}

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, prefix = 'rl', key } = options

  return async (c: Context, next: Next) => {
    const id = key ? key(c) : extractIp(c)
    const bucket = `${prefix}:${id}`

    try {
      const { data, error } = await supabase.rpc('rate_limit_hit', {
        p_key: bucket,
        p_window_ms: windowMs,
        p_max: maxRequests,
      })

      if (error || !data || !data[0]) {
        console.error('[rateLimiter] RPC error, fail-open:', error?.message)
        return await next()
      }

      const row = data[0] as { count: number; reset_at: string; allowed: boolean }
      const resetSec = Math.floor(new Date(row.reset_at).getTime() / 1000)

      c.header('X-RateLimit-Limit', String(maxRequests))
      c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - row.count)))
      c.header('X-RateLimit-Reset', String(resetSec))

      if (!row.allowed) {
        c.header('Retry-After', String(Math.max(1, resetSec - Math.floor(Date.now() / 1000))))
        return c.json({ error: 'Too many requests' }, 429)
      }

      return await next()
    } catch (err) {
      console.error('[rateLimiter] unexpected error, fail-open:', err)
      return await next()
    }
  }
}
