// Bridge between the legacy sdr_prospectos row shape and the typed ConvContext.
// Lives only as long as Fase B + Fase A are not merged. Once those land,
// loadContext() reads ConvContext from Supabase/Redis directly and this file shrinks.

import { z } from 'zod'
import {
  type ConvContext,
  type Cultivo,
  type Segmento,
  type SDRFsmState,
  type ExtractionUpdate,
  createDefaultContext,
  SDRFsmStateEnum,
  BotActionEnum,
  SignalStrengthEnum,
  type BotAction,
  type SignalStrength,
} from './context.js'
import { IntentEnum, ObjectionTypeEnum, type Intent, type ObjectionType } from '../../constants/intents.js'
import { getRedisClient } from '../../integrations/redis.js'

// ─── Legacy row shape we tolerate during the migration ───────────────────────

interface SDRProspectoRowPartial {
  id: string
  phone: string
  sdr_node?: string | null
  turns_total?: number | null
  fincas_en_cartera?: number | null
  cultivo_principal?: string | null
  pais?: string | null
  sistema_actual?: string | null
  segmento_icp?: string | null
  source_context?: string | null
  status?: string | null
  narrativa_asignada?: 'A' | 'B' | null
}

// Legacy fields that don't fit into ConvContext but the router still needs.
// Kept in a sibling object so we don't reintroduce prospecto[...] accesses.
export interface SDRLegacyFields {
  sourceContext: string | null
  statusActual: string
  narrativaAsignada: 'A' | 'B'
}

export interface HydratedSDRState {
  ctx: ConvContext
  legacy: SDRLegacyFields
}

// ─── Enum bridges (legacy strings → typed enums and back) ────────────────────

// Legacy SDRNode: 'triage' | 'discovery' | 'pitch' | 'close' | 'global_fallback'
// New SDRFsmState: 10 values (split). Bridge in both directions for storage.
function legacySDRNodeToFsmState(node: string | null | undefined): SDRFsmState {
  switch (node) {
    case 'triage': return 'triage'
    case 'discovery': return 'discovery'
    case 'pitch': return 'pitch_sent'
    case 'close': return 'closing'
    case 'global_fallback': return 'dormant'
    default: return 'triage'
  }
}

export function fsmStateToLegacySDRNode(state: SDRFsmState): string {
  switch (state) {
    case 'triage': return 'triage'
    case 'discovery': return 'discovery'
    case 'pitch_sent':
    case 'objection_handling':
      return 'pitch'
    case 'closing':
    case 'brochure_sent':
    case 'meeting_proposed':
    case 'meeting_confirmed':
      return 'close'
    case 'declined':
    case 'dormant':
      return 'global_fallback'
  }
}

function mapCultivo(c: string | null | undefined): Cultivo | null {
  if (!c) return null
  const lower = c.toLowerCase()
  if (lower.includes('cacao')) return 'cacao'
  if (lower.includes('banano') || lower.includes('platano') || lower.includes('plátano')) return 'banano'
  if (lower.includes('cafe') || lower.includes('café')) return 'cafe'
  if (lower.includes('aguacate') || lower.includes('palta')) return 'aguacate'
  if (lower.includes('piña') || lower.includes('pina')) return 'pina'
  if (lower.includes('palma')) return 'palma'
  if (lower.includes('arroz')) return 'arroz'
  if (lower.includes('maiz') || lower.includes('maíz')) return 'maiz'
  return 'otro'
}

function mapSegmento(s: string | null | undefined): Segmento {
  switch (s) {
    case 'exportadora': return 'exportadora'
    case 'cooperativa': return 'cooperativa'
    case 'ong': return 'ong'
    case 'gerente_finca':
    case 'agricultor':
      return 'agricultor'
    default: return 'desconocido'
  }
}

// ─── Hydration ───────────────────────────────────────────────────────────────

export function hydrateContext(
  prospecto: Record<string, unknown>,
  sessionState?: SessionState | null,
): HydratedSDRState {
  // Single cast at the boundary — every other prospecto[...] access in the
  // codebase is supposed to disappear after this commit.
  const p = prospecto as unknown as SDRProspectoRowPartial

  const base = createDefaultContext(String(p.id), String(p.phone))
  let ctx: ConvContext = {
    ...base,
    fsmState: legacySDRNodeToFsmState(p.sdr_node),
    cultivo: mapCultivo(p.cultivo_principal),
    pais: p.pais ?? null,
    fincasEstimadas: p.fincas_en_cartera ?? null,
    segmento: mapSegmento(p.segmento_icp),
    sistemaActual: p.sistema_actual ?? null,
    turnCount: p.turns_total ?? 0,
    // intentHistory, lastBotMessage, signalStrength, etc. stay at defaults here.
    // They get overlaid below from Redis session state if available.
  }

  // Overlay session state (Redis-backed, TTL 24h) on top of the persistent row.
  // Session-scoped fields own: intentHistory, lastBotMessage, lastBotAction,
  // lastObjectionType, signalStrength, clarificationTurnsUsed, and fsmState
  // (granular state from the new model wins over the legacy SDRNode collapse).
  if (sessionState) {
    ctx = {
      ...ctx,
      fsmState: sessionState.fsmState,
      lastBotAction: sessionState.lastBotAction,
      lastBotMessage: sessionState.lastBotMessage,
      intentHistory: sessionState.intentHistory,
      lastObjectionType: sessionState.lastObjectionType,
      signalStrength: sessionState.signalStrength,
      clarificationTurnsUsed: sessionState.clarificationTurnsUsed,
    }
  }

  // Manually recompute datosConocidos so the FSM logic sees the right count
  // even before the first reduceContext() call of the turn.
  let datos = 0
  if (ctx.cultivo) datos++
  if (ctx.pais) datos++
  if (ctx.fincasEstimadas != null) datos++
  if (ctx.sistemaActual) datos++
  if (ctx.segmento !== 'desconocido') datos++

  const legacy: SDRLegacyFields = {
    sourceContext: p.source_context ?? null,
    statusActual: p.status ?? 'new',
    narrativaAsignada: p.narrativa_asignada ?? 'A',
  }

  return { ctx: { ...ctx, datosConocidos: datos }, legacy }
}

// ─── Session state persistence (Redis, TTL 24h) ──────────────────────────────
// The persistent prospect row in Supabase owns slow-moving facts (cultivo, pais,
// segmento, fincasEstimadas, sistemaActual). The Redis session state below owns
// fast-moving conversation signals that we don't need to keep forever:
//   - intentHistory: sliding window of recent intents, used by signalStrength
//   - lastBotMessage / lastBotAction: needed to disambiguate "Ya?" style replies
//   - lastObjectionType, signalStrength, clarificationTurnsUsed, fsmState
//
// TTL 24h is intentional: SDR sales conversations rarely span more days than
// that without a fresh greeting. Expected behavior on expiry (documented in
// ADR-009): the next turn rehydrates with an empty intentHistory and the
// classifier sees the message in isolation — same as pre-Fase-C. This degrades
// the H1 fix gracefully rather than crashing.

const SESSION_TTL_SECONDS = 24 * 3600

const SessionStateSchema = z.object({
  fsmState: SDRFsmStateEnum,
  lastBotAction: BotActionEnum,
  lastBotMessage: z.string().nullable(),
  intentHistory: z.array(IntentEnum).max(20),
  lastObjectionType: ObjectionTypeEnum.nullable(),
  signalStrength: SignalStrengthEnum,
  clarificationTurnsUsed: z.number().int().min(0).max(2),
})

export type SessionState = z.infer<typeof SessionStateSchema>

function sessionKey(phone: string): string {
  return `sdr_session:${phone}`
}

export async function loadSessionState(phone: string): Promise<SessionState | null> {
  if (!phone) return null
  try {
    const client = getRedisClient()
    const raw = await client.get(sessionKey(phone))
    if (!raw) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Corrupt value — treat as no session. Next persist overwrites.
      return null
    }
    const validated = SessionStateSchema.safeParse(parsed)
    if (!validated.success) {
      // Schema drift (e.g., a new IntentEnum value was added). Discard rather
      // than crash. Next persist overwrites with the new shape.
      return null
    }
    return validated.data
  } catch (err) {
    console.warn('[contextStore] loadSessionState failed, fallback to no session:', err)
    return null
  }
}

export async function persistSessionState(ctx: ConvContext): Promise<void> {
  if (!ctx.phone) return
  try {
    const client = getRedisClient()
    const state: SessionState = {
      fsmState: ctx.fsmState,
      lastBotAction: ctx.lastBotAction,
      lastBotMessage: ctx.lastBotMessage,
      intentHistory: [...ctx.intentHistory],
      lastObjectionType: ctx.lastObjectionType,
      signalStrength: ctx.signalStrength,
      clarificationTurnsUsed: ctx.clarificationTurnsUsed,
    }
    await client.set(sessionKey(ctx.phone), JSON.stringify(state), 'EX', SESSION_TTL_SECONDS)
  } catch (err) {
    // Non-fatal: degradation is to pre-Fase-C behavior. The next turn loses
    // intentHistory and lastBotMessage and the classifier sees the message in
    // isolation. This is the documented expected behavior on TTL expiry, so
    // surfacing on Redis hiccups is also acceptable.
    console.warn('[contextStore] persistSessionState failed:', err)
  }
}

// Async wrapper that fetches session state + calls the sync hydrateContext.
// router.ts calls this instead of hydrateContext() directly so that all the
// prospecto[...] / Redis access stays inside contextStore.ts.
export async function loadHydratedContext(prospecto: Record<string, unknown>): Promise<HydratedSDRState> {
  const phone = String((prospecto as Record<string, unknown>)['phone'] ?? '')
  const sessionState = await loadSessionState(phone)
  return hydrateContext(prospecto, sessionState)
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

// Compute the partial sdr_prospectos update payload from the new ConvContext.
// Only fields whose value differs from the original hydrated state are emitted,
// so Supabase update is minimal.
export function computeLegacyUpdate(next: ConvContext, original: HydratedSDRState): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    turns_total: next.turnCount,
    sdr_node: fsmStateToLegacySDRNode(next.fsmState),
  }
  if (next.fincasEstimadas !== original.ctx.fincasEstimadas) {
    updateData.fincas_en_cartera = next.fincasEstimadas
  }
  if (next.cultivo !== original.ctx.cultivo) {
    updateData.cultivo_principal = next.cultivo
  }
  if (next.pais !== original.ctx.pais) {
    updateData.pais = next.pais
  }
  if (next.sistemaActual !== original.ctx.sistemaActual) {
    updateData.sistema_actual = next.sistemaActual
  }
  if (next.segmento !== original.ctx.segmento) {
    updateData.segmento_icp = next.segmento
  }
  return updateData
}

// Map the legacy ExtraccionSDR (snake_case, strings) to a typed ExtractionUpdate.
// This is what router.ts feeds into reduceContext().
export function mapExtraccionToUpdate(e: {
  fincas_en_cartera: number | null
  cultivo_principal: string | null
  pais: string | null
  sistema_actual: string | null
}): ExtractionUpdate {
  return {
    cultivo: mapCultivo(e.cultivo_principal),
    pais: e.pais,
    fincasEstimadas: e.fincas_en_cartera,
    sistemaActual: e.sistema_actual,
  }
}

// Build the string contextoActual the legacy classifier methods (extraerDatosSDR,
// clasificarIntencionSDR, redactarMensajeSDR) consume. Now sourced from ConvContext
// so the classifier receives intentHistory and lastBotMessage — that's the H1 fix.
export function buildContextoString(ctx: ConvContext, cachedSDRContext?: string | null): string {
  const lines = [
    `Fincas/Hectáreas: ${ctx.fincasEstimadas ?? 'Desconocido'}`,
    `Cultivo Principal: ${ctx.cultivo ?? 'Desconocido'}`,
    `País: ${ctx.pais ?? 'Desconocido'}`,
    `Sistema Actual: ${ctx.sistemaActual ?? 'Desconocido'}`,
  ]
  if (cachedSDRContext) lines.push(`Contexto Reciente: ${cachedSDRContext}`)
  if (ctx.lastBotMessage) lines.push(`Último mensaje del bot: ${ctx.lastBotMessage}`)
  if (ctx.intentHistory.length > 0) lines.push(`Intents recientes (oldest→newest): ${ctx.intentHistory.join(', ')}`)
  return lines.join('\n')
}
