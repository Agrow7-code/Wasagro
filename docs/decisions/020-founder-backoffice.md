# 020 — Founder back-office: rescoped to the operable line (S2 + S3)

**Date:** 2026-06-30
**Status:** Accepted
**Related decisions:** D28 (CLAUDE.md), ADR 012 (original back-office vision), D26 (billing), D27 (cost instrumentation), D31 (security hardening)

## Context

ADR 012 scoped the founder back-office as five slices: client list with P&L, client
detail, SDR funnel, daily management alerts, and a billing screen — depending on D26
(billing) and D27 (cost instrumentation) for the P&L/margin columns.

During design for this change, the same five slices were planned as one delivery unit.
Adversarial review of the design found that scope unsound for a single change:

- **S4 (mock → real view migration)** covers roughly ten dashboard views that currently
  render hardcoded/mock data. Each one requires a real backend endpoint (often missing
  entirely on `fincaRouter`), a data-shape rework, and replacement of hardcoded constants
  — not an import swap. Bundling this with the admin API would have produced an
  unreviewable, multi-hundred-line diff spanning unrelated subsystems.
- **S5 (P&L table + `managementAlertsWorker`)** depends on `costo_servicio_mensual` (D27)
  being populated with real, non-test data, and needs an idempotency mechanism for daily
  founder alerts (`(org_id, tipo, fecha)` uniqueness) that was not yet designed.

Shipping S4/S5 half-designed would have produced a back-office that *looks* operable but
silently shows mock data to the founder — a direct violation of this project's
non-MVP delivery standard (no client/prospect, including the founder, ever sees mock data
presented as real).

## Decision

Rescope `founder-backoffice` (D28) to the **operable line**: S2 (director role + admin
API) and S3 (admin UI). With S2+S3 alone, the founder can already operate end-to-end:
create a client from the UI, see the client list/detail with plan and status, and drill
into the views that are **already real** (Sigatoka review, FincaSetup, Billing).

### roleGuard — fail-closed, the sole gate to service_role cross-org data

`src/auth/roleGuard.ts` denies (403) on a missing/malformed `authedUser` or any
`rol !== 'director'`, and denies (500) on any thrown exception — including one thrown
from `next()` — without ever calling `next()` again from inside the catch.
`requireFincaAccessAsync` already grants `director` global access; service_role
(`src/integrations/supabase.ts`) bypasses RLS for the cross-org reads this surface needs.
No JWT re-issuance, no per-org RLS rollout dependency.

### POST /api/admin/clients calls `provisionarCliente()` directly

The admin create-client endpoint validates with the existing `ProvisionInputSchema` and
calls `provisionarCliente()` directly. It MUST NOT reuse `createProvisionHandler` — that
factory enforces `x-reporte-secret` (`REPORTE_SECRET`) for `/internal/provision-client`
only, and that secret must never be reachable from the browser. `roleGuard` is the only
gate on this route; an `x-reporte-secret` header sent to `/api/admin/clients` is simply
never read.

### maskPhone extracted to a shared util

`src/utils/maskPhone.ts` replaces the 4-way duplicated last-4 masking logic (pgBoss.ts,
alertaEntrega.ts, provisionarCliente.ts, EventHandler.ts) for the admin router's `GET
/sdr` and `GET /orgs/:id` responses. Existing call sites are not migrated in this PR —
that is a follow-up refactor with no behavioral change.

### Admin mount has no planGuard

`/api/admin/*` is mounted in `src/index.ts` with `authMiddleware` → `roleGuard` → its own
`rateLimiter` → `adminRouter`, deliberately without `planGuard`. The director's own org
billing status is irrelevant when administering other orgs; wrapping `/api/admin/*` in
`planGuard` would block all director access whenever the director's own org trial lapses.

### S4 and S5 deferred

S4 (mock→real migration, ~10 views) and S5 (P&L + `managementAlertsWorker`) are deferred
to a future sub-epic with honest per-view scoping. Until S4 ships, the admin drill-in nav
exposes **only** the three already-real views — no founder ever reaches a mock view
through `/admin`.

### Known gap carried forward (not blocking S2+S3)

`SUPABASE_ANON_KEY` is still optional in this codebase (D31). When unset,
`getUserSupabase(c) ?? supabase` falls back to service_role on drill-in routes, so RLS is
effectively off and `requireFincaAccessAsync` is the sole D31 isolation gate for every
drill-in route the admin nav can reach. This is documented, not fixed, by this change —
see D31 for the open item to make `SUPABASE_ANON_KEY` mandatory.

## Consequences

**Gains:**
- The founder can create, list, and drill into real clients today — a concrete reduction
  of the provisioning bottleneck this epic exists to close — without waiting on the full
  five-slice design.
- No founder ever sees mock data presented as real (non-MVP delivery standard upheld).
- `maskPhone` duplication is reduced from four implementations to one (used by new code;
  existing call sites unchanged).
- `roleGuard` is small, fail-closed, and independently testable — a clean foundation for
  any future RBAC refinement (ADR 012 already flagged `director` as coarse-grained).

**Costs / trade-offs:**
- The founder still does not have P&L, margin, or daily management alerts in this PR —
  ADR 012's original vision is only partially delivered. S4/S5 remain open scope.
- `GET /api/admin/orgs/:id` omits billing history (`costo_servicio_mensual`, last 6
  months) that the original admin-api spec listed — it is S5 scope, deferred here.
- The `SUPABASE_ANON_KEY` gap (D31) means D31 isolation for admin drill-in is
  app-layer-only (`requireFincaAccessAsync`) until that env var is made mandatory.

**Dependencies:** ADR 012 (original vision, still the long-term target), D26 (contractual
pricing fields surfaced in `GET /orgs`), D27 (cost data — needed for the deferred S5), D31
(security hardening — `requireFincaAccessAsync`, the `SUPABASE_ANON_KEY` gap).
