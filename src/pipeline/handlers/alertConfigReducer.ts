/**
 * T3.4 — Pure reducer for the pending_alert_config multi-turn WhatsApp flow.
 * Design: §4.4 — one campo per turn, numeric validation, opt-out keyword, abort policy.
 *
 * Models the BillingIntentHandler pattern (pure, typed, zero I/O).
 * The caller (EventHandler) is responsible for:
 *   - Opening the session with turn=0 on entry (M11)
 *   - Persisting the returned ctx back to sesiones_activas.contexto_parcial
 *   - Acting on the returned action (persist → upsertUmbralAlerta, etc.)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of sesiones_activas.contexto_parcial for a pending_alert_config session.
 * All turn/re-ask state lives here (M11 — never reuse inbound clarification counter).
 */
export interface PendingAlertConfigCtx {
  /** Canonical pest_type (output of canonicalPestType). */
  pest_type: string
  finca_id: string
  org_id: string
  /** campos still to ask, in order. Shrinks as each campo is collected. */
  pending_campos: string[]
  /** collected campo → numeric valor. */
  collected: Record<string, number>
  /** campo this turn is asking. null when all collected. */
  current_campo: string | null
  /**
   * Turn counter for clarification within the current campo.
   * Reset to 0 on session entry (M11).
   * After 1 failed attempt (turn=1) the next failure triggers abort (P2).
   */
  turn: number
  /**
   * The ask_count from decision_alerta at the time outreach was sent.
   * Carried forward so that persist/opted_out upserts preserve it instead
   * of resetting to 1 (fix #4 — anti-spam cap-3 guard).
   * Defaults to 1 when not set (sessions opened before this field was added).
   */
  ask_count?: number
}

/** Row shape passed to upsertUmbralAlerta for each collected campo. */
export interface UpsertPayloadRow {
  pest_type: string
  finca_id: string
  org_id: string
  campo: string
  valor: number
  enabled: boolean
}

export type ReducerAction = 'ask_next' | 'persist' | 'clarify' | 'abort' | 'opted_out'

export interface ReducerResult {
  ctx: PendingAlertConfigCtx
  action: ReducerAction
  /** Only present on 'persist' or 'opted_out' (enabled=false for opted_out). */
  upsertPayload?: UpsertPayloadRow[]
}

// ─── Opt-out keyword detection ────────────────────────────────────────────────

const OPT_OUT_KEYWORDS = [
  'no quiero',
  'no quiero alertas',
  'no quiero recibir',
  'desactivar',
  'deshabilitar',
  'sin alertas',
  'cancelar alertas',
  'no alerts',
]

function isOptOutReply(reply: string): boolean {
  const normalized = reply.trim().toLowerCase()
  return OPT_OUT_KEYWORDS.some(kw => normalized.includes(kw))
}

// ─── Numeric validation ───────────────────────────────────────────────────────

/**
 * Per-campo sane bounds (P1 — a typo like 99999 would silence a critical alert).
 * Percentage campos: [0.1, 100] (cannot exceed 100%).
 * Count campos (hojasFuncionalesMin): [1, 50] (reasonable leaf count range).
 * Unknown campos fall through to the default check (positive-finite).
 */
const CAMPO_BOUNDS: Record<string, { min: number; max: number }> = {
  ee3a6Severo:          { min: 0.1, max: 100 },
  ee2Avanzado:          { min: 0.1, max: 100 },
  ee2Leve:              { min: 0.1, max: 100 },
  hojasFuncionalesMin:  { min: 1,   max: 50  },
  pct_afectado:         { min: 0.1, max: 100 },
}

/**
 * Parses a reply as a positive-finite number within the per-campo sane bounds.
 * Returns null if the reply is not a valid positive number, negative, zero, NaN,
 * Infinity, or outside the sane bounds for the given campo (P1 — typo-guard).
 */
function parsePositiveFinite(reply: string, campo?: string | null): number | null {
  const trimmed = reply.trim().replace(',', '.') // handle Spanish decimal comma
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null

  // Apply per-campo sane bounds when available
  if (campo) {
    const bounds = CAMPO_BOUNDS[campo]
    if (bounds && (n < bounds.min || n > bounds.max)) return null
  }

  return n
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

/**
 * T3.4 — Pure reducer for a single inbound message turn in a pending_alert_config session.
 *
 * Flow per turn:
 *   1. Check opt-out keywords first → opted_out (upsert enabled=false for all campos).
 *   2. Parse numeric. Invalid:
 *      - turn === 0: increment turn → clarify (re-prompt the same campo).
 *      - turn === 1: abort (P2 spirit — max one re-ask per campo).
 *   3. Valid numeric: store in collected, advance to next campo.
 *      - More campos remaining → ask_next.
 *      - No more campos → persist (carry upsertPayload with all collected values).
 */
export function reduceAlertConfig(
  ctx: PendingAlertConfigCtx,
  reply: string,
): ReducerResult {
  // 1. Opt-out check (fires regardless of turn state, BillingIntentHandler pattern)
  if (isOptOutReply(reply)) {
    // Build opted_out payload: all pending_campos + already-collected campos → enabled=false
    const allCampos = [
      ...Object.keys(ctx.collected),
      ...(ctx.current_campo ? [ctx.current_campo] : []),
      ...ctx.pending_campos.filter(c => c !== ctx.current_campo),
    ]
    const uniqueCampos = [...new Set(allCampos)]
    const payload: UpsertPayloadRow[] = uniqueCampos.map(campo => ({
      pest_type: ctx.pest_type,
      finca_id: ctx.finca_id,
      org_id: ctx.org_id,
      campo,
      valor: 0,   // placeholder — enabled=false means the row is silenced anyway
      enabled: false,
    }))
    return {
      ctx: { ...ctx },
      action: 'opted_out',
      upsertPayload: payload,
    }
  }

  // 2. Parse numeric (pass current_campo for per-campo sane bounds check, P1)
  const value = parsePositiveFinite(reply, ctx.current_campo)

  if (value === null) {
    // Non-numeric reply
    if (ctx.turn >= 1) {
      // Already re-asked once → abort (P2: max one re-ask per campo)
      return {
        ctx: { ...ctx },
        action: 'abort',
      }
    }
    // First failure → clarify (ask again for the same campo)
    return {
      ctx: { ...ctx, turn: ctx.turn + 1 },
      action: 'clarify',
    }
  }

  // 3. Valid numeric — collect value for current_campo, reset turn, advance
  const campo = ctx.current_campo
  if (!campo) {
    // No campo to collect (shouldn't happen if caller is correct, but be defensive)
    return { ctx: { ...ctx }, action: 'abort' }
  }

  const newCollected: Record<string, number> = { ...ctx.collected, [campo]: value }

  // Advance to next campo
  const remainingPending = ctx.pending_campos.filter(c => c !== campo)
  const nextCampo = remainingPending[0] ?? null

  if (nextCampo !== null) {
    // More campos to collect
    const newCtx: PendingAlertConfigCtx = {
      ...ctx,
      collected: newCollected,
      pending_campos: remainingPending,
      current_campo: nextCampo,
      turn: 0,  // reset turn for the next campo
    }
    return { ctx: newCtx, action: 'ask_next' }
  }

  // All campos collected → persist
  const allCampos = Object.keys(newCollected)
  const upsertPayload: UpsertPayloadRow[] = allCampos.map(c => ({
    pest_type: ctx.pest_type,
    finca_id: ctx.finca_id,
    org_id: ctx.org_id,
    campo: c,
    valor: newCollected[c]!,
    enabled: true,
  }))

  const finalCtx: PendingAlertConfigCtx = {
    ...ctx,
    collected: newCollected,
    pending_campos: [],
    current_campo: null,
    turn: 0,
  }

  return { ctx: finalCtx, action: 'persist', upsertPayload }
}
