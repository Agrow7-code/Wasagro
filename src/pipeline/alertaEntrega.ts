/**
 * T2.4 / T2.6 / T2.8 — Alert delivery orchestration for per-pest field alerts.
 *
 * Implements the generic per-pest firing + delivery path described in design §6.
 * PR#3b: Called from EventHandler at the farmer confirmation point (pending_confirmation → saveEvento),
 * AFTER eventos_campo is inserted. This is the canonical delivery path for confirmed events.
 * The pgBoss extraction-stage call remains gated OFF (ALERT_DELIVERY_ENABLED default off).
 *
 * Three layers per design §6:
 *   §6.3 — Quarantine bypass: alerta_cuarentena pests always fire (threshold=1,
 *           never silenced, never configured). Short-circuits BEFORE the resolver.
 *   §6.2 — Non-Sigatoka real-time delivery: resolveUmbrales → fireAlerts →
 *           deliver to getAdminsByFinca (alertaClima pattern). Unconfigured = silent.
 *   §6.4 — M12 founder-shadow: DISABLED until PR#3 implements decision_alerta.ask_count.
 *           is_first_alert is always false; founderShadow path is kept but unreachable.
 *
 * Idempotency (#1): entregarAlertaPlaga checks markAlertaEntregada before sending.
 * The caller (pgBoss) passes a markAlertaEntregada fn keyed by event_id so retries
 * (retryLimit=3 on procesar-intencion) do not re-deliver the same alert.
 *
 * Cross-tenant (#4, D31): getAdminsByFinca rows include org_id; delivery only sends to
 * admins whose org_id matches the context org_id.
 */
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { AdminRow, DecisionMakerRow } from './supabaseQueries.js'
import {
  extractObservation,
  resolveUmbrales,
  fireAlerts,
  type UmbralAlertaRow,
  type ResolvedUmbrales,
  type FiredAlert,
} from './handlers/umbralesAlerta.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mask a phone number to last 4 digits for log safety (P5/D31). */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****'
  return `****${phone.slice(-4)}`
}

// ─── Context & Deps ───────────────────────────────────────────────────────────

/**
 * Context for a single pest alert delivery. Populated from pgBoss job data
 * after plagaNormalizer runs (design §6.2, §6.3).
 */
export interface AlertaEntregaContext {
  finca_id: string
  org_id: string
  /** Canonical pest_type (output of canonicalPestType) */
  pest_type: string
  /** Human-readable pest name for message copy */
  pest_nombre_comun: string
  /** True when plagaNormalizer.alerta_cuarentena is set (Moko, Fusarium) */
  is_quarantine: boolean
  /** Raw campos_extraidos from the LLM extraction */
  campos_extraidos: Record<string, unknown>
  traceId: string
  /**
   * M12: is_first_alert via decision_alerta.ask_count (PR#3b).
   * EventHandler sets this by reading decision_alerta at confirmation time:
   * ask_count=0 (or no row) → first alert ever for (finca, pest).
   * pgBoss extraction path still passes false (M12 disabled for that path).
   */
  is_first_alert?: boolean
}

/**
 * Injected dependencies for alertaEntrega (testable, alertaClima pattern).
 */
export interface AlertaEntregaDeps {
  sender: IWhatsAppSender
  getAdminsByFinca: (fincaId: string) => Promise<AdminRow[]>
  /** For quarantine delivery to decision-makers (design §6.3). */
  getDecisionMakersByOrg: (orgId: string) => Promise<DecisionMakerRow[]>
  getUmbralesAlerta: (orgId: string, fincaId: string, pestType: string) => Promise<UmbralAlertaRow[]>
  /** FOUNDER_PHONE env value (undefined = skip). */
  founderPhone: string | undefined
  /**
   * M12 opt-in flag. Kept in interface for API compat but currently inert:
   * is_first_alert is always false (M12 deferred to PR#3).
   */
  founderShadow?: boolean
  /**
   * Idempotency (#1): called with the event_id to mark alert as delivered.
   * Returns true if this is a fresh delivery (not yet marked), false if already sent.
   * Caller provides a no-op when event_id is unavailable (quarantine always fires).
   */
  markAlertaEntregada?: (eventId: string) => Promise<boolean>
  /**
   * event_id from eventos_campo for idempotency keying.
   * When absent, idempotency guard is skipped (e.g. quarantine, or no persisted event yet).
   */
  eventId?: string
}

/**
 * Structured result for logging (design §6.2 — Alert Delivery Logging).
 */
export interface AlertaEntregaResult {
  alert_sent: boolean
  finca_id: string
  pest_type: string
  reason: 'quarantine' | 'threshold_crossed' | 'unconfigured' | 'opted_out' | 'below_threshold' | 'no_observation' | 'already_sent' | 'no_recipients'
  /** The threshold value that was crossed (if configured). */
  resolved_threshold?: number
  /** The observed value that crossed the threshold (if fired). */
  observed_value?: number
  campo?: string
  enabled?: boolean
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildMensajeAlertaPlaga(
  pestNombre: string,
  fincaId: string,
  firedAlerts: FiredAlert[],
): string {
  const campos = firedAlerts
    .map(a => `• ${a.campo}: ${a.value} (umbral: ${a.threshold})`)
    .join('\n')
  return `⚠️ Alerta de plaga — ${pestNombre} (${fincaId})\n${campos}`
}

function buildMensajeAlertaCuarentena(
  pestNombre: string,
  fincaId: string,
): string {
  // FLAG (agrónomo sign-off pending): "Acción inmediata requerida" at threshold=1
  // needs confirmation before first paying finca (P7/D29).
  return `🚨 ALERTA CUARENTENA — ${pestNombre} detectado en finca ${fincaId}. Acción inmediata requerida.`
}

function buildMensajeFounderPreview(
  pestNombre: string,
  fincaId: string,
  orgId: string,
  firedAlerts: FiredAlert[],
): string {
  const campos = firedAlerts
    .map(a => `  ${a.campo}: ${a.value} (umbral ${a.threshold})`)
    .join('\n')
  return `[PREVIEW — primera alerta]\n${pestNombre} | finca ${fincaId} | org ${orgId}\n${campos}\nEsta alerta se entregó al cliente.`
}

// ─── Core delivery function ───────────────────────────────────────────────────

/**
 * Orchestrates alert delivery for a single pest event.
 * Never throws (P4). Returns a structured log result.
 *
 * MUST be called AFTER marcarIntencionCompletada / event persistence (P7).
 *
 * Flow (design §6):
 *   0. Idempotency check: if eventId + markAlertaEntregada, skip if already sent.
 *   1. Is quarantine? → always fire, deliver to admins + decision-makers, return.
 *   2. Fetch umbrales_alerta rows → resolveUmbrales.
 *   3. No enabled rows? → unconfigured, silent. Log and return.
 *   4. resolveUmbrales returns non-null but all are disabled (enabled=false)?
 *      → opted_out, silent. Log and return.
 *   5. extractObservation maps campos_extraidos → observations.
 *   6. fireAlerts → FiredAlert[]. Empty? → below_threshold or no_observation.
 *   7. Cross-tenant filter: only admins whose org_id matches ctx.org_id (D31).
 *   8. M12 founder-shadow: ENABLED (PR#3b). isFirstAlert from ctx.is_first_alert (set by EventHandler
 *      from decision_alerta.ask_count; false when pgBoss calls this path).
 *   9. Deliver to getAdminsByFinca (deduped by phone, alertaClima pattern).
 */
export async function entregarAlertaPlaga(
  ctx: AlertaEntregaContext,
  deps: AlertaEntregaDeps,
): Promise<AlertaEntregaResult> {
  const { finca_id, org_id, pest_type, pest_nombre_comun, is_quarantine, campos_extraidos, traceId } = ctx
  const { sender, getAdminsByFinca, getDecisionMakersByOrg, getUmbralesAlerta, founderPhone, founderShadow, markAlertaEntregada, eventId } = deps

  // ── §0 Idempotency guard ────────────────────────────────────────────────────
  // Only applies to non-quarantine (quarantine always fires by design H3/ADR-G).
  // markAlertaEntregada returns false when already marked → skip re-send on retry.
  if (!is_quarantine && eventId && markAlertaEntregada) {
    const isFresh = await markAlertaEntregada(eventId).catch((err: unknown) => {
      // DB failure: log but proceed (fail-open on idempotency is safer than silent drop
      // for a real pest alert — the alternative is to never send if DB is flaky).
      console.error('[alertaEntrega] markAlertaEntregada failed, proceeding with delivery:', { eventId, err })
      return true
    })
    if (!isFresh) {
      console.log('[alertaEntrega] already sent (idempotency guard)', { finca_id, pest_type, eventId, traceId })
      return { alert_sent: false, finca_id, pest_type, reason: 'already_sent' }
    }
  }

  // ── §6.3 Quarantine bypass ──────────────────────────────────────────────────
  // Short-circuits BEFORE resolver, BEFORE opt-in check.
  // Fixed threshold = 1 occurrence. Never silenced.
  if (is_quarantine) {
    const mensaje = buildMensajeAlertaCuarentena(pest_nombre_comun, finca_id)

    // Deliver to both admins AND decision-makers (design §6.3).
    // getAdminsByFinca and getDecisionMakersByOrg may overlap; dedup by phone.
    const [admins, decisionMakers] = await Promise.all([
      getAdminsByFinca(finca_id).catch((err: unknown) => {
        console.error('[alertaEntrega] getAdminsByFinca failed (quarantine):', err)
        return [] as AdminRow[]
      }),
      // When org_id is available, fetch org decision-makers; otherwise finca-only (design §6.3 + #6).
      org_id
        ? getDecisionMakersByOrg(org_id).catch((err: unknown) => {
            console.error('[alertaEntrega] getDecisionMakersByOrg failed (quarantine):', err)
            return [] as DecisionMakerRow[]
          })
        : Promise.resolve([] as DecisionMakerRow[]),
    ])

    // Cross-tenant safety: only admins from the correct org (D31).
    const orgAdmins = org_id
      ? admins.filter(a => a.org_id === org_id)
      : admins

    const seen = new Set<string>()
    const targets = [
      ...orgAdmins.map(a => a.phone),
      ...decisionMakers.map(d => d.phone),
    ].filter(phone => {
      if (seen.has(phone)) return false
      seen.add(phone)
      return true
    })

    if (targets.length === 0) {
      // No recipients — quarantine pest with no admins/decision-makers is a config gap (P4).
      console.error('[alertaEntrega] quarantine alert: no recipients found', {
        finca_id, org_id, pest_type, traceId,
        admins_count: admins.length, dm_count: decisionMakers.length,
      })
      return { alert_sent: false, finca_id, pest_type, reason: 'no_recipients' }
    }

    const failures: string[] = []
    for (const phone of targets) {
      await sender.enviarTexto(phone, mensaje).catch((err: unknown) => {
        failures.push(maskPhone(phone))
        console.warn(`[alertaEntrega] fallo enviando alerta cuarentena a ${maskPhone(phone)}:`, err)
      })
    }

    if (failures.length > 0) {
      console.error('[alertaEntrega] partial quarantine delivery failure', {
        finca_id, org_id, pest_type, traceId,
        sent: targets.length - failures.length,
        failed: failures.length,
      })
    }

    console.log('[alertaEntrega] quarantine alert sent', {
      finca_id, org_id, pest_type, traceId, targets: targets.length,
    })

    // alert_sent:true even on partial failures — the alert was attempted for reachable targets.
    // Partial failures are surfaced via console.error above (P4).
    return {
      alert_sent: true,
      finca_id,
      pest_type,
      reason: 'quarantine',
    }
  }

  // ── §6.2 Non-Sigatoka real-time delivery ────────────────────────────────────

  // Fetch threshold config from umbrales_alerta table.
  let rows: UmbralAlertaRow[]
  try {
    rows = await getUmbralesAlerta(org_id, finca_id, pest_type)
  } catch (err) {
    console.error('[alertaEntrega] getUmbralesAlerta failed:', { finca_id, org_id, pest_type, err })
    // Fail safe: treat as unconfigured rather than crashing (P4).
    return { alert_sent: false, finca_id, pest_type, reason: 'unconfigured' }
  }

  // Check if there are ANY rows (including disabled) to distinguish unconfigured from opted-out.
  const hasAnyRows = rows.length > 0
  const enabledRows = rows.filter(r => r.enabled)

  if (!hasAnyRows) {
    // Truly unconfigured — no rows at all.
    console.log('[alertaEntrega] unconfigured pest, silent', { finca_id, pest_type, traceId })
    return { alert_sent: false, finca_id, pest_type, reason: 'unconfigured' }
  }

  if (enabledRows.length === 0) {
    // Rows exist but all are disabled — opted out (enabled=false).
    console.log('[alertaEntrega] pest opted-out (all rows disabled)', { finca_id, pest_type, traceId })
    return { alert_sent: false, finca_id, pest_type, reason: 'opted_out', enabled: false }
  }

  // Resolve precedence (finca > org).
  const resolved: ResolvedUmbrales | null = resolveUmbrales(rows)
  if (!resolved) {
    // All enabled rows were malformed (non-finite valor). Treat as unconfigured.
    console.warn('[alertaEntrega] resolveUmbrales returned null (malformed rows?)', { finca_id, pest_type, traceId })
    return { alert_sent: false, finca_id, pest_type, reason: 'unconfigured' }
  }

  // Map LLM campos_extraidos → catalog campo names.
  const observations = extractObservation(pest_type, campos_extraidos)

  if (Object.keys(observations).length === 0) {
    console.log('[alertaEntrega] no mapped observations for pest', { finca_id, pest_type, campos_extraidos, traceId })
    return { alert_sent: false, finca_id, pest_type, reason: 'no_observation' }
  }

  // Evaluate thresholds.
  const firedAlerts = fireAlerts(resolved, { finca_id, pest_type, observations })

  if (firedAlerts.length === 0) {
    const firstCampo = Object.keys(resolved)[0]
    const firstRule = firstCampo ? resolved[firstCampo] : undefined
    console.log('[alertaEntrega] threshold not crossed', {
      finca_id, pest_type, observations, traceId,
    })
    const belowResult: AlertaEntregaResult = {
      alert_sent: false,
      finca_id,
      pest_type,
      reason: 'below_threshold',
    }
    if (firstRule !== undefined) belowResult.resolved_threshold = firstRule.valor
    return belowResult
  }

  // Threshold crossed — build message and deliver.
  const firstFired = firedAlerts[0] as FiredAlert
  const mensaje = buildMensajeAlertaPlaga(pest_nombre_comun, finca_id, firedAlerts)

  // ── §6.4 M12 founder-shadow ─────────────────────────────────────────────────
  // PR#3b: is_first_alert is now determined by EventHandler via decision_alerta.ask_count.
  // ask_count=0 (or no row) at confirmation time → first alert ever for this (finca, pest).
  // The pgBoss path still passes is_first_alert=false (M12 disabled for the old extraction path).
  const isFirstAlert = ctx.is_first_alert ?? false
  if (founderShadow && isFirstAlert && founderPhone) {
    const preview = buildMensajeFounderPreview(pest_nombre_comun, finca_id, org_id, firedAlerts)
    await sender.enviarTexto(founderPhone, preview).catch((err: unknown) => {
      console.warn('[alertaEntrega] fallo enviando founder preview:', err)
    })
    console.log('[alertaEntrega] M12 founder-shadow preview sent', {
      finca_id, pest_type, founderPhone: maskPhone(founderPhone), traceId,
    })
  }

  // Deliver to finca admins (alertaClima pattern: getAdminsByFinca + enviarTexto, deduped).
  let admins: AdminRow[]
  try {
    admins = await getAdminsByFinca(finca_id)
  } catch (err) {
    console.error('[alertaEntrega] getAdminsByFinca failed (delivery):', { finca_id, err })
    admins = []
  }

  // Cross-tenant safety: only send to admins belonging to the correct org (D31).
  const orgAdmins = admins.filter(a => a.org_id === org_id)
  if (orgAdmins.length < admins.length) {
    console.warn('[alertaEntrega] cross-tenant filter removed admins for wrong org', {
      finca_id, org_id, removed: admins.length - orgAdmins.length, traceId,
    })
  }

  if (orgAdmins.length === 0) {
    console.error('[alertaEntrega] no recipients after org filter', {
      finca_id, org_id, pest_type, traceId,
    })
    return { alert_sent: false, finca_id, pest_type, reason: 'no_recipients' }
  }

  // For non-quarantine delivery, audience is admins only (design §5, ADR-F).
  // Dedup by phone (alertaClima/alertaPrecio pattern).
  const seenPhones = new Set<string>()
  const failures: string[] = []
  for (const admin of orgAdmins) {
    if (seenPhones.has(admin.phone)) continue
    seenPhones.add(admin.phone)
    await sender.enviarTexto(admin.phone, mensaje).catch((err: unknown) => {
      failures.push(maskPhone(admin.phone))
      console.warn(`[alertaEntrega] fallo enviando alerta a ${maskPhone(admin.phone)}:`, err)
    })
  }

  if (failures.length > 0) {
    console.error('[alertaEntrega] partial delivery failure', {
      finca_id, pest_type, traceId,
      sent: seenPhones.size - failures.length,
      failed: failures.length,
    })
  }

  const result: AlertaEntregaResult = {
    alert_sent: true,
    finca_id,
    pest_type,
    reason: 'threshold_crossed',
    resolved_threshold: firstFired.threshold,
    observed_value: firstFired.value,
    campo: firstFired.campo,
  }

  console.log('[alertaEntrega] alert sent', result)
  return result
}
