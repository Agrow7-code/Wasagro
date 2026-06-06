// Empuja los prompts del disco a Langfuse Prompts.
//
// Uso:
//   npm run prompts:sync                            # todos los prompts a label 'production'
//   npm run prompts:sync -- --label staging         # a label staging
//   npm run prompts:sync -- --only sp-04a*          # solo los que matchean glob
//   npm run prompts:sync -- --dry-run               # lista lo que pushearia, sin tocar nada
//
// Requiere LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY + (opcional) LANGFUSE_HOST.
// Cada prompt sube como version nueva (incremento automatico). El label
// determina cual version pickea PromptManager.getPrompt() en runtime.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { langfuse } from '../src/integrations/langfuse.js'

interface SyncSource {
  dir:  string
  prefix?: string  // si se quiere agrupar por carpeta
}

const SOURCES: SyncSource[] = [
  { dir: 'prompts' },
  { dir: 'sdr/prompts' },
  { dir: 'prompts/orchestrator' },  // intent-detector.txt vive aca (no .md, manejado abajo)
]

interface ParsedArgs {
  label:    string
  only?:    string
  dryRun:   boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { label: 'production', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--label' && argv[i + 1]) { out.label = argv[++i]! }
    else if (arg === '--only' && argv[i + 1]) { out.only = argv[++i]! }
    else if (arg === '--dry-run') { out.dryRun = true }
  }
  return out
}

function shouldInclude(name: string, only?: string): boolean {
  if (!only) return true
  // Glob simple: solo * al final o sin wildcard.
  if (only.endsWith('*')) return name.startsWith(only.slice(0, -1))
  return name === only
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!process.env['LANGFUSE_SECRET_KEY'] || !process.env['LANGFUSE_PUBLIC_KEY']) {
    console.error('FATAL: LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY requeridos.')
    process.exit(1)
  }

  const cwd = process.cwd()
  let pushed = 0
  let skipped = 0
  let failed = 0

  for (const { dir } of SOURCES) {
    const dirPath = join(cwd, dir)
    if (!existsSync(dirPath)) {
      console.warn(`[sync] dir ${dir} no existe, skip.`)
      continue
    }

    const files = readdirSync(dirPath).filter(f => f.endsWith('.md') || f.endsWith('.txt'))
    for (const file of files) {
      const name = file  // matches PromptManager.getPrompt(name) lookups
      if (!shouldInclude(name, args.only)) {
        skipped++
        continue
      }

      const filePath = join(dirPath, file)
      const content = readFileSync(filePath, 'utf-8')
      const chars = content.length

      if (args.dryRun) {
        console.log(`[DRY] would push ${name} from ${dir} (${chars} chars) -> label ${args.label}`)
        pushed++
        continue
      }

      try {
        await (langfuse as any).createPrompt({
          name,
          prompt: content,
          type:   'text',
          labels: [args.label],
        })
        console.log(`✓ pushed ${name} (${chars} chars) -> label ${args.label}`)
        pushed++
      } catch (err) {
        console.error(`✗ FAILED ${name}: ${err instanceof Error ? err.message : String(err)}`)
        failed++
      }
    }
  }

  if (!args.dryRun) {
    await (langfuse as any).flushAsync?.()
  }

  console.log(`\nDone. pushed=${pushed} skipped=${skipped} failed=${failed}`)

  if (pushed > 0 && !args.dryRun) {
    const host = process.env['LANGFUSE_HOST'] ?? 'https://cloud.langfuse.com'
    console.log(`\n  → Verificá la sección Prompts: ${host}/prompts`)
    console.log(`  → Smoke test del setup: npm run langfuse:status`)
  }

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
