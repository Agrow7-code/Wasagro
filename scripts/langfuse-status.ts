// Smoke test del setup de LangFuse.
//
// Uso:
//   npm run langfuse:status
//
// Verifica que:
//   1. Las env vars LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY están definidas.
//   2. La conexión a Langfuse funciona (intenta crear una trace dummy).
//   3. Lista todos los prompts que el handler espera contra los que están en
//      Langfuse — reporta diff.
//
// Output tipo:
//   ✓ Env vars OK (host: cloud.langfuse.com)
//   ✓ Connection OK (trace dummy id=xxx)
//   ✗ Missing prompts in Langfuse (5 prompts en disco no fueron synceados):
//       - sp-04a-onboarding-admin.md
//       - SP-SDR-03-writer.md
//   → Run: npm run prompts:sync

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadDotEnv } from './lib/loadDotEnv.js'

// Cargar .env ANTES de importar langfuse — el SDK lee process.env en module-init.
const dotenvResult = loadDotEnv()

import { langfuse } from '../src/integrations/langfuse.js'

const PROMPTS_DIRS = ['prompts', 'sdr/prompts', 'prompts/orchestrator']

function reportEnv(): boolean {
  const pk = process.env['LANGFUSE_PUBLIC_KEY']
  const sk = process.env['LANGFUSE_SECRET_KEY']
  const host = process.env['LANGFUSE_HOST'] ?? 'https://cloud.langfuse.com'
  if (!pk || !sk) {
    console.error('✗ Env vars FALTAN:')
    if (!pk) console.error('  - LANGFUSE_PUBLIC_KEY')
    if (!sk) console.error('  - LANGFUSE_SECRET_KEY')
    console.error('\nExportá las variables y re-ejecutá. Setup queda bloqueado hasta entonces.')
    return false
  }
  console.log(`✓ Env vars OK (host: ${host})`)
  return true
}

async function checkConnection(): Promise<boolean> {
  try {
    const trace = (langfuse as any).trace({
      name:     'langfuse_status_smoke_test',
      tags:     ['system', 'smoke-test'],
      metadata: { script: 'langfuse-status', when: new Date().toISOString() },
    })
    trace.event({ name: 'smoke_test_ping', level: 'DEFAULT' })
    await (langfuse as any).flushAsync?.()
    console.log(`✓ Connection OK (smoke-test trace name: langfuse_status_smoke_test)`)
    return true
  } catch (err) {
    console.error(`✗ Connection FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

function listDiskPrompts(): string[] {
  const cwd = process.cwd()
  const all: string[] = []
  for (const dir of PROMPTS_DIRS) {
    const fullPath = join(cwd, dir)
    if (!existsSync(fullPath)) continue
    for (const f of readdirSync(fullPath)) {
      if (f.endsWith('.md') || f.endsWith('.txt')) all.push(f)
    }
  }
  return [...new Set(all)].sort()
}

async function checkPromptsInLangfuse(diskPrompts: string[]): Promise<void> {
  const missing: string[] = []
  const present: string[] = []
  for (const name of diskPrompts) {
    try {
      const prompt = await (langfuse as any).getPrompt(name, undefined, { cacheTtlSeconds: 0 })
      if (prompt?.prompt) {
        present.push(name)
      } else {
        missing.push(name)
      }
    } catch {
      missing.push(name)
    }
  }

  console.log(`\n--- Prompts inventory ---`)
  console.log(`✓ En Langfuse (${present.length}): ${present.length ? present.slice(0, 5).join(', ') + (present.length > 5 ? ` ...y ${present.length - 5} más` : '') : '(ninguno)'}`)

  if (missing.length > 0) {
    console.log(`✗ Faltan en Langfuse (${missing.length}):`)
    for (const m of missing) console.log(`    - ${m}`)
    console.log(`\n  → Para sincronizar: npm run prompts:sync`)
    console.log(`  → Para preview: npm run prompts:sync -- --dry-run`)
  } else {
    console.log(`\n  Todos los ${diskPrompts.length} prompts del disco están en Langfuse. 🎯`)
  }
}

async function main(): Promise<void> {
  console.log('═══ LangFuse Status Check ═══\n')

  if (dotenvResult.loaded) {
    console.log(`✓ .env cargado (${dotenvResult.count} vars nuevas; las del sistema tienen prioridad)\n`)
  } else {
    console.log(`ℹ .env no encontrado — usando solo env vars del sistema\n`)
  }

  if (!reportEnv()) process.exit(1)

  const connectionOk = await checkConnection()
  if (!connectionOk) {
    console.error('\nConnection check falló. Verificá que las keys sean válidas + el host alcanzable.')
    process.exit(1)
  }

  const diskPrompts = listDiskPrompts()
  console.log(`\n--- Discovery ---`)
  console.log(`✓ Prompts en disco: ${diskPrompts.length}`)

  await checkPromptsInLangfuse(diskPrompts)

  console.log(`\n═══ Done ═══`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
