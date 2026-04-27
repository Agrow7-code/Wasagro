import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!url || !key) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos')

export const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    // Timeout de 8 segundos para queries - Vercel serverless tiene 10s por defecto
    fetch: (input, init) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout))
    },
  },
})
