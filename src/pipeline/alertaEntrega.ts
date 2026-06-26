/**
 * T2.4 / T2.6 / T2.8 — Alert delivery orchestration for per-pest field alerts.
 *
 * Implements the generic per-pest firing + delivery path described in design §6.
 * Called from pgBoss when a pest event is normalized (alerta_urgente flag).
 *
 * Three layers per design §6:
 *   §6.3 — Quarantine bypass: alerta_cuarentena pests always fire (threshold=1,
 *           never silenced, never configured). Short-circuits BEFORE the resolver.
 *   §6.2 — Non-Sigatoka real-time delivery: resolveUmbrales → fireAlerts →
 *           deliver to getAdminsByFinca (alertaClima pattern). Unconfigured = silent.
 *   §6.4 — M12 founder-shadow: on first fired alert per (finca, pest) AND
 *           founderShadow=true, route preview via sender to founderPhone before
 *           client delivery. Flag defaults off so no client gets a surprise (P7).
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
   * M12: true if this is the VERY FIRST fired alert for (finca_id, pest_type).
   * Caller is responsible for tracking via decision_alerta.ask_count (design §6.4).
   * Defaults to false.
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
   * M12 opt-in flag. When true AND is_first_alert, send preview to founderPhone
   * before client delivery (design §6.4). Defaults to false so no surprise alerts.
   */
  founderShadow?: boolean
}

/**
 * Structured result for logging (design §6.2 — Alert Delivery Logging).
 */
export interface AlertaEntregaResult {
  alert_sent: boolean
  finca_id: string
  pest_type: string
  reason: 'quarantine' | 'threshold_crossed' | 'unconfigured' | 'opted_out' | 'below_threshold' | 'no_observation'
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
 * Flow (design §6):
 *   1. Is quarantine? → always fire, deliver to admins + decision-makers, return.
 *   2. Fetch umbrales_alerta rows → resolveUmbrales.
 *   3. No enabled rows? → unconfigured, silent. Log and return.
 *   4. resolveUmbrales returns non-null but all are disabled (enabled=false)?
 *      → opted_out, silent. Log and return.
 *   5. extractObservation maps campos_extraidos → observations.
 *   6. fireAlerts → FiredAlert[]. Empty? → below_threshold or no_observation.
 *   7. M12 founder-shadow: if is_first_alert AND founderShadow=true → preview send.
 *   8. Deliver to getAdminsByFinca (deduped by phone, alertaClima pattern).
 */
export async function entregarAlertaPlaga(
  ctx: AlertaEntregaContext,
  deps: AlertaEntregaDeps,
): Promise<AlertaEntregaResult> {
  const { finca_id, org_id, pest_type, pest_nombre_comun, is_quarantine, campos_extraidos, traceId } = ctx
  const { sender, getAdminsByFinca, getDecisionMakersByOrg, getUmbralesAlerta, founderPhone, founderShadow } = deps

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
      getDecisionMakersByOrg(org_id).catch((err: unknown) => {
        console.error('[alertaEntrega] getDecisionMakersByOrg failed (quarantine):', err)
        return [] as DecisionMakerRow[]
      }),
    ])

    const seen = new Set<string>()
    const targets = [
      ...admins.map(a => a.phone),
      ...decisionMakers.map(d => d.phone),
    ].filter(phone => {
      if (seen.has(phone)) return false
      seen.add(phone)
      return true
    })

    for (const phone of targets) {
      await sender.enviarTexto(phone, mensaje).catch((err: unknown) => {
        console.warn(`[alertaEntrega] fallo enviando alerta cuarentena a ${phone}:`, err)
      })
    }

    console.log('[alertaEntrega] quarantine alert sent', {
      finca_id, org_id, pest_type, traceId, targets: targets.length,
    })

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

  // ── §6.4 M12 founder-shadow: send preview before client delivery ────────────
  const isFirstAlert = ctx.is_first_alert ?? false
  if (founderShadow && isFirstAlert && founderPhone) {
    const preview = buildMensajeFounderPreview(pest_nombre_comun, finca_id, org_id, firedAlerts)
    await sender.enviarTexto(founderPhone, preview).catch((err: unknown) => {
      console.warn('[alertaEntrega] fallo enviando founder preview:', err)
    })
    console.log('[alertaEntrega] M12 founder-shadow preview sent', {
      finca_id, pest_type, founderPhone, traceId,
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

  // For non-quarantine delivery, audience is admins only (design §5, ADR-F).
  // Dedup by phone (alertaClima/alertaPrecio pattern).
  const seenPhones = new Set<string>()
  for (const admin of admins) {
    if (seenPhones.has(admin.phone)) continue
    seenPhones.add(admin.phone)
    await sender.enviarTexto(admin.phone, mensaje).catch((err: unknown) => {
      console.warn(`[alertaEntrega] fallo enviando alerta a ${admin.phone}:`, err)
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
