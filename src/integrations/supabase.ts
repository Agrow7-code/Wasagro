import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!url || !key) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos')

// Promise.race es la única forma confiable de timeout en serverless:
// AbortController puede no propagar el rechazo si el socket se cuelga a nivel TCP/TLS,
// dejando la promise pendiente para siempre. Race garantiza que el timer SIEMPRE gana.
function fetchConTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return Promise.race([
    fetch(input, init),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout (5s)')), 5000)
    ),
  ])
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
