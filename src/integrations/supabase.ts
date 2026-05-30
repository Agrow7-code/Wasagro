import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
const anonKey = process.env['SUPABASE_ANON_KEY']

if (!url || !key) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos')

const SUPABASE_TIMEOUT_MS = 5000

// Fetch wrapper that actually aborts the underlying request on timeout.
// The previous Promise.race approach only rejected the promise — the request
// kept running until natural completion, leaking sockets under load.
function fetchConTimeout(input: any, init?: any): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)
  // Compose with any caller-supplied signal: if the caller aborts, we abort too.
  const callerSignal: AbortSignal | undefined = init?.signal
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    fetch: fetchConTimeout,
  },
})

export function createUserScopedClient(jwt: string) {
  if (!url) throw new Error('SUPABASE_URL requerido')
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY requerido para cliente con scope de usuario')

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      fetch: fetchConTimeout,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
