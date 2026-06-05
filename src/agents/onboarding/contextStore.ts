// Bridge between OnboardingContext (Fase F second half) and the legacy
// session.contexto_parcial bag stored in Supabase `sesiones_activas`.
//
// Mirrors src/agents/sdr/contextStore.ts pattern. Reads the new `ctx` key when
// present and falls back to legacy keys (historial, datos, consent_saved) for
// rows written by pre-Fase-F handler code. Writes BOTH formats so a partial
// deploy revert doesn't lose data — the legacy keys can be dropped once
// ctx-first reads are confirmed everywhere (planned for commit 3).

import {
  OnboardingContextSchema,
  type OnboardingContext,
  type OnboardingFlow,
  createDefaultContext,
} from './context.js'
import type {
  ContextoConversacion,
  ContextoOnboardingAgricultor,
} from '../../types/dominio/Onboarding.js'
import { getRedisClient } from '../../integrations/redis.js'

// Shape we actually consume from `sesiones_activas` rows.
export interface OnboardingSessionRow {
  session_id:           string
  contexto_parcial:     Record<string, unknown>
  clarification_count:  number
}

export interface UsuarioMinimal {
  id:    string
  phone: string
}

// ─── Hydration ──────────────────────────────────────────────────────────────

export function hydrateOnboardingContext(
  session: OnboardingSessionRow,
  usuario: UsuarioMinimal,
  tipoFlujo: OnboardingFlow,
): OnboardingContext {
  const cp = session.contexto_parcial ?? {}

  // New path: `ctx` already stored as serialized OnboardingContext.
  // Defensive: validate against the schema. If validation fails (schema drift,
  // partial write, etc.) we fall through to the legacy path rather than
  // crashing — same graceful degradation as SDR's contextStore.
  const stored = cp['ctx']
  if (stored && typeof stored === 'object' && stored !== null) {
    const validated = OnboardingContextSchema.safeParse(stored)
    if (validated.success) {
      return validated.data
    }
  }

  // Legacy path: reconstruct from the individual `historial`, `datos`,
  // `consent_saved` keys that pre-Fase-F handler code wrote.
  const historialRaw = cp['historial']
  const historial = Array.isArray(historialRaw)
    ? (historialRaw as Array<{ rol: 'usuario' | 'agente'; contenido: string }>).slice(-20)
    : []

  const datos = (cp['datos'] as Record<string, unknown>) ?? {}
  const consentSavedFlag = Boolean(cp['consent_saved'])

  const base = createDefaultContext(usuario.id, usuario.phone, tipoFlujo)

  // The legacy clarification_count was abused as a step counter (not actual
  // clarification turns), so we map it to pasoSiguiente. clarificationTurnsUsed
  // resets to 0 — it has no legacy analog, and the reducer will recompute.
  return {
    ...base,
    historial,
    consentimiento:         consentSavedFlag || datos['consentimiento'] === true,
    nombre:                 readString(datos, 'nombre'),
    rol:                    readString(datos, 'rol'),
    fincaNombre:            readString(datos, 'finca_nombre'),
    fincaUbicacionTexto:    readString(datos, 'finca_ubicacion_texto'),
    fincaId:                readString(datos, 'finca_id'),
    cultivoPrincipal:       readString(datos, 'cultivo_principal'),
    pais:                   readString(datos, 'pais'),
    lotes:                  readLotes(datos),
    pasoCompletado:         Math.max(0, session.clarification_count - 1),
    pasoSiguiente:          Math.max(1, session.clarification_count + 1),
    clarificationTurnsUsed: 0,
  }
}

function readString(datos: Record<string, unknown>, key: string): string | null {
  const v = datos[key]
  return typeof v === 'string' ? v : null
}

function readLotes(datos: Record<string, unknown>): Array<{ nombre_coloquial: string; hectareas: number | null }> {
  const raw = datos['lotes']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .map(l => ({
      nombre_coloquial: typeof l['nombre_coloquial'] === 'string' ? l['nombre_coloquial'] : '',
      hectareas:        typeof l['hectareas']        === 'number' ? l['hectareas']        : null,
    }))
    .filter(l => l.nombre_coloquial !== '')
}

// ─── Projections to legacy LLM signatures ───────────────────────────────────
// WasagroAIAgent.onboardarAdmin still takes ContextoConversacion and
// onboardarAgricultor takes ContextoOnboardingAgricultor. These bridges build
// the legacy shapes from the new ctx so the LLM signature stays back-compat.

export function toContextoConversacion(ctx: OnboardingContext): ContextoConversacion {
  return {
    historial:            ctx.historial,
    preguntas_realizadas: ctx.clarificationTurnsUsed,
    datos_recolectados:   datosForLLM(ctx),
  }
}

export function toContextoAgricultor(
  ctx: OnboardingContext,
  fincasDisponibles: string,
): ContextoOnboardingAgricultor {
  return {
    historial:           ctx.historial,
    paso_actual:         ctx.pasoSiguiente,
    datos_recolectados:  datosForLLM(ctx),
    fincas_disponibles:  fincasDisponibles,
  }
}

function datosForLLM(ctx: OnboardingContext): Record<string, unknown> {
  return {
    nombre:                ctx.nombre,
    rol:                   ctx.rol,
    consentimiento:        ctx.consentimiento,
    finca_nombre:          ctx.fincaNombre,
    finca_ubicacion_texto: ctx.fincaUbicacionTexto,
    finca_id:              ctx.fincaId,
    cultivo_principal:     ctx.cultivoPrincipal,
    pais:                  ctx.pais,
    lotes:                 ctx.lotes,
  }
}

// ─── Serialization for persistence ──────────────────────────────────────────
// Writes the new `ctx` key AND the legacy keys (`historial`, `datos`,
// `consent_saved`) on every persist. Belt-and-suspenders so a partial deploy
// revert doesn't strand half the data — the old code reads from legacy keys,
// the new code reads from ctx. Commit 3 will drop the legacy writes once
// the migration is verified in prod.

export function serializeContextForSession(ctx: OnboardingContext): Record<string, unknown> {
  return {
    ctx,
    historial:     ctx.historial,
    datos:         datosForLLM(ctx),
    consent_saved: ctx.consentimiento,
  }
}

// ─── Redis cache layer (TTL 24h) ────────────────────────────────────────────
// Supabase `sesiones_activas` is the source of truth — Redis is a hot-path
// cache to avoid the Postgres round-trip on every turn of a short-lived
// onboarding (≤10 turns). If Redis is down/missing, hydrate falls back to
// Supabase transparently. If Redis has corrupt/drifted data, safeParse rejects
// it and we also fall back. Same graceful-degradation policy as SDR commit 3.

const ONBOARDING_CACHE_TTL_SECONDS = 24 * 3600

function cacheKey(phone: string): string {
  return `onboarding_session:${phone}`
}

export async function loadCachedOnboardingContext(phone: string): Promise<OnboardingContext | null> {
  if (!phone) return null
  try {
    const client = getRedisClient()
    const raw = await client.get(cacheKey(phone))
    if (!raw) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Corrupt — next persist overwrites.
      return null
    }
    const validated = OnboardingContextSchema.safeParse(parsed)
    if (!validated.success) {
      // Schema drift (new field added since cache was written). Discard and
      // fall back to Supabase. Next persist re-hydrates the cache.
      return null
    }
    return validated.data
  } catch (err) {
    console.warn('[onboarding contextStore] loadCachedOnboardingContext failed:', err)
    return null
  }
}

export async function cacheOnboardingContext(ctx: OnboardingContext): Promise<void> {
  if (!ctx.phone) return
  try {
    const client = getRedisClient()
    await client.set(cacheKey(ctx.phone), JSON.stringify(ctx), 'EX', ONBOARDING_CACHE_TTL_SECONDS)
  } catch (err) {
    // Non-fatal — Supabase is source of truth. Next turn just pays the
    // Postgres round-trip until Redis recovers.
    console.warn('[onboarding contextStore] cacheOnboardingContext failed:', err)
  }
}

export async function invalidateOnboardingCache(phone: string): Promise<void> {
  if (!phone) return
  try {
    const client = getRedisClient()
    await client.del(cacheKey(phone))
  } catch {
    // Non-fatal. TTL will expire it within 24h anyway.
  }
}
