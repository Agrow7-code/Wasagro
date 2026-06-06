// Tiny .env loader sin dependencias. Soporta:
//   - Líneas blanco/comentario (#)
//   - KEY=value
//   - KEY="value" o KEY='value' (strip de quotes)
//   - NO sobrescribe env vars ya definidas (las del sistema ganan al .env)
//
// Limitaciones intencionales:
//   - No soporta multi-línea ni escapes complejos (si necesitás eso, mové la
//     config a env vars del sistema o usá dotenv).
//
// Uso desde un script:
//   import { loadDotEnv } from './lib/loadDotEnv.js'
//   loadDotEnv()  // al inicio, antes de leer process.env

import { existsSync, readFileSync } from 'node:fs'

export function loadDotEnv(path = '.env'): { loaded: boolean; count: number } {
  if (!existsSync(path)) return { loaded: false, count: 0 }

  const content = readFileSync(path, 'utf-8')
  let count = 0

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    let value = line.slice(eqIdx + 1).trim()

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // System env vars always win over .env (no override).
    if (!(key in process.env)) {
      process.env[key] = value
      count++
    }
  }

  return { loaded: true, count }
}
