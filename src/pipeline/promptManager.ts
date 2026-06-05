import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { langfuse } from '../integrations/langfuse.js'

// Langfuse Prompts integration con disk fallback.
//
// Flow:
//   1. getPrompt(name, fallbackPath) intenta fetch de Langfuse por nombre.
//   2. Langfuse devuelve la version con label 'production' (or latest if no label).
//   3. Si Langfuse no esta configurado, falla, o el prompt no existe alla,
//      fallback a leer del disco local (fallbackPath).
//   4. Cache TTL 5 min — los handlers no pagan round-trip a Langfuse por turno.
//
// Para subir prompts del disco a Langfuse por primera vez: `npm run prompts:sync`.
// El script lee de prompts/ y sdr/prompts/, pushea cada uno como version nueva
// con label 'production'. Tras eso, los handlers automaticamente pickean la
// version production sin re-deploy.

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutos
const langfuseConfigured = !!(process.env['LANGFUSE_SECRET_KEY'] && process.env['LANGFUSE_PUBLIC_KEY'])

interface CachedEntry {
  text:      string
  promptObj: unknown | null  // PromptClient de Langfuse (null = vino de disco)
  cachedAt:  number
}

const cache = new Map<string, CachedEntry>()

export class PromptManager {
  static async getPrompt(nombre: string, fallbackPath: string, _traceId?: string): Promise<string> {
    const cached = cache.get(nombre)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.text
    }

    // ── Path 1: Langfuse Prompts (con label 'production' si esta seteado) ──
    if (langfuseConfigured) {
      try {
        // SDK v3: getPrompt(name, version?, options?). version undefined -> usa label production.
        const promptObj = await (langfuse as any).getPrompt(nombre, undefined, {
          cacheTtlSeconds: Math.floor(CACHE_TTL_MS / 1000),
        })
        const text = String(promptObj?.prompt ?? '')
        if (text.length > 0) {
          cache.set(nombre, { text, promptObj, cachedAt: Date.now() })
          return text
        }
      } catch (err) {
        // No-fatal — degradacion a disco. Probable causa: prompt no fue
        // sync-eado todavia, o Langfuse cloud temporalmente down.
        console.warn(`[PromptManager] Langfuse fetch for "${nombre}" failed, falling back to disk:`, err instanceof Error ? err.message : String(err))
      }
    }

    // ── Path 2: disk fallback ─────────────────────────────────────────────
    try {
      const text = readFileSync(join(process.cwd(), fallbackPath), 'utf-8')
      cache.set(nombre, { text, promptObj: null, cachedAt: Date.now() })
      return text
    } catch (fsErr) {
      throw new Error(`Error crítico: No se pudo cargar el prompt local (${fallbackPath}). Detalles: ${String(fsErr)}`)
    }
  }

  // Devuelve el PromptClient de Langfuse SI el prompt vino de Langfuse.
  // Adapters lo usan para linkear generaciones a la version exacta del prompt
  // (langfuse SDK acepta { prompt: PromptClient } en trace.generation).
  // Devuelve null si vino de disco (no hay PromptClient que linkear).
  static getPromptClient(nombre: string): unknown | null {
    return cache.get(nombre)?.promptObj ?? null
  }

  // Tests + sync script usan esto para forzar refresh.
  static clearCache(): void {
    cache.clear()
  }
}
