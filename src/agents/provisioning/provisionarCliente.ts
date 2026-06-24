// Domain orchestration for client provisioning (D33, client-provisioning change).
// This function is consumer-agnostic: it does not reference Hono, REPORTE_SECRET, or
// any transport layer. The HTTP endpoint (PR-C) calls it; D28 back-office will call it
// directly without touching the endpoint.
//
// Atomicity contract: org + admin + user_consent are created by the RPC
// provisionar_cliente_atomico in a single Postgres transaction. Idempotency is handled
// here by checking for an existing user before calling the RPC.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getUserByPhone,
  provisionarClienteAtomico,
  type ProvisionarClienteAtomicoArgs,
} from '../../pipeline/supabaseQueries.js'

// ─── HTTP boundary schema (snake_case input → camelCase ProvisionInput) ───────
//
// Rules encoded here:
// - consent_texto: non-empty (.min(1)) and max-length-bounded (.max(2000)) to
//   prevent storage-abuse blobs (spec: Security and Non-Enumeration; P4/P5).
// - tipo_org: the DB enum only has 'individual' | 'empresa'. 'cooperativa' is
//   accepted at this boundary and mapped to 'empresa' (D26 intent: cooperativa
//   is a segment of empresa/corporate). This prevents the DB enum constraint from
//   being violated by callers who use the common term. Documented here so the
//   mapping is not implicit in the domain function.
// - telefono_admin: required, non-empty string (E.164 is not enforced here to
//   avoid false rejections on formatting variants; the domain function validates
//   the phone is not already registered).

export const ProvisionInputSchema = z.object({
  nombre_org: z.string().min(1),
  pais: z.string().min(1).max(2),
  tipo_org: z
    .enum(['individual', 'empresa', 'cooperativa'])
    .optional()
    .transform((v) => (v === 'cooperativa' ? 'empresa' : v) as 'individual' | 'empresa' | undefined),
  telefono_admin: z.string().min(1),
  nombre_admin: z.string().min(1),
  cultivo_principal: z.string().min(1),
  fincas_contratadas: z.number().int().positive().optional(),
  usuarios_contratados: z.number().int().positive().optional(),
  consent_texto: z.string().min(1).max(2000),
}).transform((data) => ({
  nombreOrg: data.nombre_org,
  pais: data.pais,
  tipoOrg: data.tipo_org,
  telefonoAdmin: data.telefono_admin,
  nombreAdmin: data.nombre_admin,
  cultivoPrincipal: data.cultivo_principal,
  fincasContratadas: data.fincas_contratadas,
  usuariosContratados: data.usuarios_contratados,
  consentTexto: data.consent_texto,
}))

// Inferred type of the transformed (camelCase) output — matches ProvisionInput exactly.
export type ProvisionInputFromSchema = z.output<typeof ProvisionInputSchema>

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ProvisionInput {
  nombreOrg: string
  pais: string
  /**
   * 'cooperativa' is not a valid DB enum value; it maps to 'empresa'.
   * PR-C's Zod schema documents this mapping at the HTTP boundary.
   */
  tipoOrg?: 'individual' | 'empresa' | 'cooperativa'
  telefonoAdmin: string   // E.164 — idempotency key
  nombreAdmin: string
  cultivoPrincipal: 'banano' | 'cacao' | string
  fincasContratadas?: number   // default 1
  usuariosContratados?: number // default 1
  consentTexto: string         // exact P6 consent text shown/agreed upon
}

export interface ProvisionResult {
  orgId: string
  usuarioId: string
  yaExistia: boolean   // true if this was an idempotent no-op (phone already registered)
}

/**
 * Optional seed function injected via deps.
 * If not provided (PR-D not yet implemented), seeding is skipped silently.
 * If provided and it throws, the error is logged but provisionarCliente still resolves (P4).
 */
export type SeedFn = (orgId: string, cultivoPrincipal: string, client?: SupabaseClient) => Promise<void>

export interface ProvisionDeps {
  client?: SupabaseClient        // injectable for tests (default: service-role client)
  seedMetricasPlantilla?: SeedFn // optional — belongs to PR-D; not required for PR-B
  trace?: { event: (name: string, body?: unknown) => void }  // P4 observability
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps tipoOrg input to the DB enum ('individual' | 'empresa').
 * 'cooperativa' is treated as 'empresa' because the DB enum does not include it.
 */
function mapTipoOrg(tipoOrg: ProvisionInput['tipoOrg']): 'individual' | 'empresa' {
  if (tipoOrg === 'individual') return 'individual'
  // 'empresa' and 'cooperativa' (unsupported) both map to 'empresa'
  return 'empresa'
}

// ─── Domain function ──────────────────────────────────────────────────────────

/**
 * Provisions a new client org + admin user + user_consent in one atomic operation,
 * or returns the existing account if the phone is already registered (idempotent).
 *
 * Flow:
 * 1. Validate consent (synchronous, before any DB call)
 * 2. Idempotency check: getUserByPhone — if found, return yaExistia=true
 * 3. RPC provisionar_cliente_atomico — atomic: org + admin + consent in one tx
 * 4. Best-effort seed (if seedMetricasPlantilla is injected)
 * 5. Return { orgId, usuarioId, yaExistia: false }
 */
export async function provisionarCliente(
  input: ProvisionInput,
  deps: ProvisionDeps = {},
): Promise<ProvisionResult> {
  // Step 1 — Consent validation (synchronous, P6 guard)
  if (!input.consentTexto || !input.consentTexto.trim()) {
    throw new Error('consent_required')
  }

  const client = deps.client

  // Step 2 — Idempotency: check if phone already registered
  const existing = await getUserByPhone(input.telefonoAdmin, client as SupabaseClient | undefined)
  if (existing !== null) {
    if (!existing.org_id) {
      // Anomalous DB state: a user row exists but has no org. This must never be silently
      // double-provisioned — creating a second org would violate P6 (duplicate consent) and
      // data integrity. Fail-closed and surface for human intervention (P1/P7).
      throw new Error(
        `orphan_user_no_org: phone ${input.telefonoAdmin} exists in usuarios without org_id — requires human intervention`,
      )
    }
    deps.trace?.event('provision.idempotent_noop', { phone: input.telefonoAdmin, orgId: existing.org_id })
    return { orgId: existing.org_id, usuarioId: existing.id, yaExistia: true }
  }

  // Step 3 — Atomic RPC: creates org + admin + consent in a single Postgres transaction.
  // org_id is generated atomically inside the RPC (advisory lock + sequential assignment).
  // No p_org_id is passed — it is intentionally absent from ProvisionarClienteAtomicoArgs.
  const rpcArgs: ProvisionarClienteAtomicoArgs = {
    p_nombre_org: input.nombreOrg,
    p_tipo: mapTipoOrg(input.tipoOrg),
    p_pais: input.pais,
    p_fincas: input.fincasContratadas ?? 1,
    p_usuarios: input.usuariosContratados ?? 1,
    p_phone: input.telefonoAdmin,
    p_nombre_admin: input.nombreAdmin,
    p_consent_texto: input.consentTexto,
  }

  const { orgId, usuarioId } = await provisionarClienteAtomico(rpcArgs, client as SupabaseClient | undefined)
  deps.trace?.event('provision.created', { orgId, usuarioId })

  // Step 4 — Best-effort seed (PR-D concern, optional injection)
  // If seedMetricasPlantilla is not provided, skip silently (PR-D not yet implemented).
  // If it throws, log the error but do not re-throw (P4: errors logged, not silenced or propagated).
  if (deps.seedMetricasPlantilla) {
    try {
      await deps.seedMetricasPlantilla(orgId, input.cultivoPrincipal, client)
      deps.trace?.event('provision.seed_ok', { orgId })
    } catch (err) {
      console.error('[provisionarCliente] seed failed (best-effort, non-fatal):', err)
      deps.trace?.event('provision.seed_error', { orgId, error: String(err) })
    }
  }

  return { orgId, usuarioId, yaExistia: false }
}
