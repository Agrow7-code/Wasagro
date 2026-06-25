/**
 * T1.10 — Pure domain logic for configurable alert thresholds.
 * No I/O. All functions are pure over injected data.
 * Design: §3 (Threshold Resolution), §3.1-3.3.
 */
import type { UmbralesSeveridad } from './SigatokaHandler.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Row shape from the umbrales_alerta table (design §2.1). */
export interface UmbralAlertaRow {
  id: string
  org_id: string
  finca_id: string | null
  finca_scope: string          // GENERATED: COALESCE(finca_id, '*')
  pest_type: string
  campo: string
  operador: 'gt' | 'gte' | 'lt' | 'lte'
  valor: number
  enabled: boolean
}

/** A single resolved (enabled) rule for one campo. */
export interface ResolvedRule {
  campo: string
  operador: 'gt' | 'gte' | 'lt' | 'lte'
  valor: number
  /** 'finca' when resolved from a per-finca override; 'org' when from org default. */
  source: 'finca' | 'org'
}

/**
 * Resolved umbrales for one (pest_type, finca) context.
 * Map of campo → resolved rule. Only enabled rules are present.
 * Null means "no rules configured" → silent.
 */
export type ResolvedUmbrales = Record<string, ResolvedRule>

/** Catalog entry for a per-pest alert field. */
export interface PestAlertField {
  campo: string
  operador: 'gt' | 'gte' | 'lt' | 'lte'
  label: string
  unit: string
  /** Default value to show in the UI when no rule is configured yet. */
  default: number
  /** Raw campos_extraidos keys that map to this campo (§3.3 H6). */
  sourceKeys: string[]
}

// ─── canonicalPestType ────────────────────────────────────────────────────────

/**
 * Converts a pest common name to a canonical snake_case pest_type key.
 * Used by both table writes and runtime reads to ensure consistent matching
 * (H6, design §3.3 — without this, fireAlerts silently never matches, P4).
 */
export function canonicalPestType(nombre_comun: string): string {
  return nombre_comun
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

// ─── PEST_ALERT_FIELDS catalog ────────────────────────────────────────────────

/**
 * Per-pest alert field catalog. Declares each alert campo, its operator,
 * a human label, unit, UI default, and the raw campos_extraidos source keys
 * that map to it (§3.3, §8).
 * Initial: Sigatoka negra (4 campos) + Moniliasis (1 campo).
 */
export const PEST_ALERT_FIELDS: Record<string, PestAlertField[]> = {
  sigatoka_negra: [
    {
      campo: 'ee3a6Severo',
      operador: 'gt',
      label: '% plantas EE3-6 severo (J)',
      unit: '%',
      default: 10,
      sourceKeys: ['ee3a6Severo', 'peorJ'],
    },
    {
      campo: 'ee2Avanzado',
      operador: 'gt',
      label: '% plantas EE2 avanzado 4+ (I)',
      unit: '%',
      default: 5,
      sourceKeys: ['ee2Avanzado', 'peorI'],
    },
    {
      campo: 'ee2Leve',
      operador: 'gt',
      label: '% plantas EE2 leve 1-3 (H)',
      unit: '%',
      default: 30,
      sourceKeys: ['ee2Leve', 'peorH'],
    },
    {
      campo: 'hojasFuncionalesMin',
      operador: 'lt',
      label: 'Mínimo hojas funcionales (M)',
      unit: 'hojas',
      default: 9,
      sourceKeys: ['hojasFuncionalesMin', 'peorM'],
    },
  ],
  moniliasis: [
    {
      campo: 'pct_afectado',
      operador: 'gt',
      label: '% mazorcas afectadas',
      unit: '%',
      default: 20,
      // LLM may emit 'pct_afectado' or 'incidencia' for the same concept (§3.3)
      sourceKeys: ['pct_afectado', 'incidencia'],
    },
  ],
}

// ─── extractObservation ───────────────────────────────────────────────────────

/**
 * Maps raw campos_extraidos keys to catalog campo names for a given pest_type.
 * Unmapped or absent keys are skipped (logged, not thrown, P4).
 * Returns a Record of campo → observed numeric value.
 */
export function extractObservation(
  pestType: string,
  campos_extraidos: Record<string, unknown>,
): Record<string, number> {
  const fields = PEST_ALERT_FIELDS[pestType]
  if (!fields) return {}

  const result: Record<string, number> = {}

  for (const field of fields) {
    let found = false
    for (const key of field.sourceKeys) {
      const raw = campos_extraidos[key]
      if (raw !== undefined && raw !== null) {
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isFinite(n)) {
          result[field.campo] = n
          found = true
          break
        }
      }
    }
    if (!found) {
      const hasAnyKey = field.sourceKeys.some(k => k in campos_extraidos)
      if (hasAnyKey) {
        console.warn(
          `[extractObservation] ${pestType}.${field.campo}: key present but not numeric`,
          { sourceKeys: field.sourceKeys, campos_extraidos },
        )
      }
    }
  }

  return result
}

// ─── resolveUmbrales ─────────────────────────────────────────────────────────

/**
 * Pure resolver: takes a set of umbrales_alerta rows (fetched for a specific
 * pest_type, org, finca) and applies finca-over-org precedence.
 *
 * Per (pest_type, campo):
 *   1. Per-finca row (finca_id NOT NULL) → wins.
 *   2. Org-default row (finca_id NULL) → used if no per-finca.
 *   3. Absent → not included (silent).
 *
 * Only enabled=true rows survive. Invalid valor (NaN/Infinity) rows are
 * logged and skipped (design §3.1, malformed config safe fallback, P4).
 *
 * Returns null when there are no enabled rows (unconfigured → silent path).
 */
export function resolveUmbrales(rows: UmbralAlertaRow[]): ResolvedUmbrales | null {
  // Build two maps: per-finca and org-default, per campo.
  const fincaMap = new Map<string, UmbralAlertaRow>()
  const orgMap = new Map<string, UmbralAlertaRow>()

  for (const row of rows) {
    if (!row.enabled) continue

    // Validate valor
    if (!Number.isFinite(row.valor)) {
      console.warn('[resolveUmbrales] Malformed row: valor is not finite, skipping', {
        id: row.id,
        campo: row.campo,
        valor: row.valor,
      })
      continue
    }

    if (row.finca_id !== null) {
      // Per-finca row — overwrite if already present (last finca row wins; caller
      // should only pass rows for one finca but we're defensive)
      fincaMap.set(row.campo, row)
    } else {
      orgMap.set(row.campo, row)
    }
  }

  // Merge: finca wins over org for each campo
  const allCampos = new Set([...fincaMap.keys(), ...orgMap.keys()])
  if (allCampos.size === 0) return null

  const resolved: ResolvedUmbrales = {}
  for (const campo of allCampos) {
    const row = fincaMap.get(campo) ?? orgMap.get(campo)
    if (!row) continue
    resolved[campo] = {
      campo,
      operador: row.operador,
      valor: row.valor,
      source: fincaMap.has(campo) ? 'finca' : 'org',
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : null
}

// ─── toUmbralesSeveridad ──────────────────────────────────────────────────────

/**
 * Adapter: converts a ResolvedUmbrales map to the UmbralesSeveridad shape that
 * buildWhatsappSummary expects (preserving its rich per-plant rendering, D29).
 *
 * Sentinel values (design §3.2, M9, H5):
 *   - gt campo not in resolved → Infinity  (peor > Infinity is never true → silent)
 *   - lt campo not in resolved → -Infinity (peor < -Infinity is never true → silent)
 *
 * NEVER returns a hardcoded numeric default — that would reintroduce a second
 * source of truth and defeat the whole point of cutover.
 */
export function toUmbralesSeveridad(resolved: ResolvedUmbrales): UmbralesSeveridad {
  const get = (campo: string, fallback: number): number => {
    const rule = resolved[campo]
    return rule ? rule.valor : fallback
  }

  return {
    ee3a6Severo:        get('ee3a6Severo', Infinity),
    ee2Avanzado:        get('ee2Avanzado', Infinity),
    ee2Leve:            get('ee2Leve', Infinity),
    hojasFuncionalesMin: get('hojasFuncionalesMin', -Infinity),
  }
}
