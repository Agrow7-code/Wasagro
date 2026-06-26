# Apply Progress: configurable-alert-thresholds — PR#1 + PR#2

**Branch**: `feat/alert-thresholds-pr2`
**Latest batch**: PR#2 remediation (adversarial review fixes — all 8 MUST-FIX items)
**Date**: 2026-06-26
**tsc --noEmit exit**: 0 (zero errors, exactOptionalPropertyTypes enforced)
**Vitest PR#2 tests**: 54 passed / 0 failed (2 test files: 34 umbralesAlerta + 20 alertaEntrega)

---

## T1.* Task Status (PR#1 — completed on feat/alert-thresholds-pr1)

### Migration tasks

- [x] **T1.1** Test: `tests/pipeline/umbralesAlerta.migration.test.ts` — 9 tests asserting the full 10-value CHECK list including `pending_alert_config` + RLS policy contract for migrations 075+076.
- [x] **T1.2** Migration `20260625000068_add-pending-alert-config-status.sql` — DROP+ADD CHECK adding `pending_alert_config` alongside `pending_sigatoka_aclaracion`.
- [x] **T1.3** Migration `20260625000069_add-umbrales-alerta.sql` — `umbrales_alerta` table with `finca_scope` generated column for NULL-safe UNIQUE (H8), trigger reusing `wasagro_set_updated_at`, RLS enabled.
- [x] **T1.4** Migration `20260625000070_add-decision-alerta.sql` — `decision_alerta` table (not_asked/asked/decided/opted_out), trigger, RLS enabled.
- [x] **T1.5** Migration `20260625000071_add-sesiones-pending-index.sql` — partial index on `sesiones_activas(phone)` WHERE status IN pending_*.
- [x] **T1.6** Migration `20260625000072_update-gc-function.sql` — `CREATE OR REPLACE FUNCTION wasagro_cleanup_expired()` extended. Last statement, explicit `$function$` dollar-quote tags, own file.
- [x] **T1.7** Migration `20260625000073_seed-umbrales-alerta-defaults.sql` — idempotent DML seed. `ON CONFLICT DO NOTHING`. `ee2Leve` seeded `enabled=false`.
- [x] **T1.8** Migrations `20260625000074_rls-umbrales-alerta.sql` (REVOKE/GRANT), `20260625000075_rls-policies-umbrales-alerta.sql` (CREATE POLICY umbrales_alerta), `20260625000076_rls-policies-decision-alerta.sql` (CREATE POLICY decision_alerta) — one concern per file, splitter-safe.

### Domain / pure logic tasks

- [x] **T1.9** Tests: `tests/pipeline/umbralesAlerta.test.ts` — 23 unit tests.
- [x] **T1.10** `src/pipeline/handlers/umbralesAlerta.ts` — pure domain logic, zero I/O.

### Persistence layer

- [x] **T1.11** Tests: 40 tests in `tests/pipeline/supabaseQueries.test.ts` — includes NULL-safe .or() assertion, named constraint assertion, precedence test.
- [x] **T1.12** `src/pipeline/supabaseQueries.ts` — Fix 1: .or() for NULL-safe query; Fix 4: named constraint `uq_umbrales_alerta_scope`; Fix 8: director org_id design documented.

### EventHandler integration

- [x] **T1.13** Tests: 8 tests in `tests/pipeline/SigatokaHandler.test.ts` T1.13 section — 4 original + 4 no-regression behavioral invariants (Fix 2).
- [x] **T1.14** `src/pipeline/handlers/EventHandler.ts` — Fix 2: `umbralesFinca` initialized to `UMBRALES_SEVERIDAD_DEFAULT` explicitly. J/I/M never silenced.

### Auth middleware

- [x] **T1.15** Tests: 14 tests in `tests/auth/middleware.test.ts`.
- [x] **T1.16** `src/auth/middleware.ts` — Fix 6: `requireOrgAccessAsync` returns `'ok'|'unauthorized'|'forbidden'`.

### Web endpoints

- [x] **T1.17** Tests: `tests/agents/finca/alertaConfig.test.ts` — 11 tests including Fix 5 and Fix 9.
- [x] **T1.18** `src/agents/finca/router.ts` — Fix 5: `canonicalPestType()` before catalog lookup; Zod bounds. Fix 6: 401/403 distinction.

### Type-check gate

- [x] **T1.19** `tsc --noEmit` exits 0.

---

## T2.* Task Status (PR#2 — completed)

### Generic fireAlerts

- [x] **T2.1** Tests: `tests/pipeline/umbralesAlerta.test.ts` additions — 11 new tests for `fireAlerts`. gt/lt/gte/lte operators; boundary cases; FiredAlert shape (finca_id, pest_type, campo, value, threshold); empty resolved → no fires; Sigatoka peorJ/I/H/M via extractObservation sourceKeys.
- [x] **T2.2** `src/pipeline/handlers/umbralesAlerta.ts` — `FiredAlert` and `PestObservation` types exported; `fireAlerts(resolved, ctx): FiredAlert[]` pure. Evaluates operador per enabled rule. No I/O.

### Quarantine bypass + non-Sigatoka delivery + M12 founder-shadow

- [x] **T2.3** Tests: `tests/pipeline/alertaEntrega.test.ts` (NEW) — quarantine pest fires regardless of umbrales_alerta state; fires even with no row; fires even when opted_out; `getUmbralesAlerta` NOT called (short-circuits before resolver); non-quarantine no-config → silent.
- [x] **T2.4** `src/workers/pgBoss.ts` quarantine path updated — tracks `alertaCuarentena` flag from `normalizarPlaga`, calls `entregarAlertaPlaga` with `is_quarantine: true`. Short-circuits before resolver per design §6.3.
- [x] **T2.5** Tests: `tests/pipeline/alertaEntrega.test.ts` additions — Moniliasis configured pct_afectado=20 fires when incidencia=22%; opted-out (all enabled=false) → silent; unconfigured → silent no exception; structured log contract; dedup by phone.
- [x] **T2.6** `src/workers/pgBoss.ts` alerta_urgente path — `extractObservation` → `resolveUmbrales` → `fireAlerts` → deliver to `getAdminsByFinca` (deduped, alertaClima pattern). Unconfigured = silent. LangFuse event `alerta_plaga_delivery`.
- [x] **T2.7** Tests: M12 DISABLED — no founder preview even with founderShadow=true + is_first_alert=true; no preview when shadow=false; no preview when not first alert. (Updated from original T2.7 — M12 disabled until PR#3.)
- [x] **T2.8** `src/pipeline/alertaEntrega.ts` (NEW) — M12 founder-shadow: DISABLED until PR#3. `isFirstAlert = false` unconditionally. Logic present but unreachable.

### Type-check gate

- [x] **T2.9** `tsc --noEmit` exits 0. 54 PR#2 tests pass (34 umbralesAlerta + 20 alertaEntrega).

---

## PR#2 Adversarial Review Remediation (all MUST-FIX applied)

| Fix | Severity | Status | Commit |
|-----|----------|--------|--------|
| #1 Idempotency guard (`markAlertaEntregada` + migration) | CRITICAL | DONE | `e820a3d`, `cc6b877` |
| #2 P7: delivery moved after `marcarIntencionCompletada` | CRITICAL | DONE | `0670b16` |
| #3 M12 `is_first_alert: false` unconditionally (disabled) | BLOCKER | DONE | `0670b16`, `cc6b877` |
| #4 Cross-tenant: AdminRow org_id + filter in delivery | CRITICAL | DONE | `4794bc5`, `cc6b877` |
| #5 Zero-recipients → `alert_sent:false, reason:'no_recipients'` | CRITICAL | DONE | `cc6b877` |
| #6 Missing orgId: quarantine fires finca-scoped; logs error | CRITICAL | DONE | `0670b16`, `cc6b877` |
| #7 PII: `maskPhone()` helper in all phone log interpolations | HIGH | DONE | `cc6b877` |
| #8 Tests: idempotency, cross-tenant, no-recipients, quarantine-partial, T2.5 dedup fix | HIGH | DONE | `1bfe091` |
| forbidOnly CI | SKIP | Verified non-issue | noted |
| Quarantine copy "Acción inmediata" sign-off | FLAG | Pending agrónomo | noted |

---

## Advisory-review fixes applied (PR#1)

| Fix | Severity | Commit |
|-----|----------|--------|
| Fix 1 — getUmbralesAlerta SQL NULL bug (.in → .or) | CRITICAL | `6c12d81` |
| Fix 2 — explicit UMBRALES_SEVERIDAD_DEFAULT fail-safe + 4 regression tests | CRITICAL | `41bc645` |
| Fix 3 — RLS policies (migr. 075+076) | HIGH | `9edb019` / `c5453c6` |
| Fix 4 — upsertUmbralAlerta named constraint | HIGH | `6c12d81` |
| Fix 5 — pest_type canonicalization + Zod bounds | HIGH | `c5453c6` |
| Fix 6 — requireOrgAccessAsync 401 vs 403 | MEDIUM | `c5453c6` |
| Fix 7 — orgId empty-string covered by Fix 2 | MEDIUM | covered |
| Fix 8 — director org_id design decision documented | MEDIUM | `6c12d81` |
| Fix 9 — strict 200 assertion | WARNING | `c5453c6` |
| forbidOnly CI — verified not a bug | SKIP | noted |

---

## Commit SHAs (PR#1)

| SHA | Description |
|-----|-------------|
| `e9c6219` | feat(db): add pending_alert_config to sesiones_activas CHECK |
| `c25929e` | feat(db): umbrales_alerta + decision_alerta tables + GC + RLS |
| `1b4b06c` | feat(db): seed org-default sigatoka umbrales |
| `584cadd` | feat(thresholds): pure domain logic |
| `49b886d` | docs(steering): add D34 |
| `63383d8` | feat(auth): requireOrgAccessAsync |
| `ffb2132` | feat(thresholds): EventHandler dual-read |
| `ea64926` | feat(thresholds): alert config web endpoints |
| `6c12d81` | fix(thresholds): null-safe getUmbralesAlerta + named onConflict |
| `41bc645` | fix(thresholds): explicit fail-safe in EventHandler |
| `9edb019` | fix(db): RLS policies (combined, split in next) |
| `c5453c6` | fix(db): RLS 075+076 + pest_type normalization + 401/403 + assertions |
| `280ea35` | test(thresholds): migration contract test for 075+076 |
| `f474c54` | feat(thresholds): configurable alert thresholds — PR#1 foundation (D34) |

## Commit SHAs (PR#2 original)

| SHA | Description |
|-----|-------------|
| `7f04e89` | feat(thresholds): generic fireAlerts engine (T2.1-T2.2) |
| `4b44e8e` | feat(thresholds): alert delivery + quarantine bypass + pgBoss wiring (T2.3-T2.8) |

## Commit SHAs (PR#2 remediation)

| SHA | Description |
|-----|-------------|
| `e820a3d` | feat(db): add alerta_plaga_entregada_at for alert delivery idempotency |
| `4794bc5` | fix(queries): add org_id to AdminRow + getAdminsByFinca select for cross-tenant guard |
| `cc6b877` | fix(delivery): idempotency guard, cross-tenant filter, no-recipients, M12 disable, PII masking, quarantine partial failure |
| `0670b16` | fix(pgBoss): move alert delivery after persistence (P7), fix is_first_alert=false (M12), quarantine without orgId |
| `1bfe091` | test(delivery): idempotency, cross-tenant, no-recipients, M12 disabled, quarantine partial failure, orgId-less quarantine |

---

## Migration filenames (10 total, PR#1 + PR#2 remediation)

- `20260625000068_add-pending-alert-config-status.sql`
- `20260625000069_add-umbrales-alerta.sql`
- `20260625000070_add-decision-alerta.sql`
- `20260625000071_add-sesiones-pending-index.sql`
- `20260625000072_update-gc-function.sql`
- `20260625000073_seed-umbrales-alerta-defaults.sql`
- `20260625000074_rls-umbrales-alerta.sql`
- `20260625000075_rls-policies-umbrales-alerta.sql`
- `20260625000076_rls-policies-decision-alerta.sql`
- `20260626000077_add-alerta-plaga-entregada-at.sql`

---

## Deferred to PR#3 / PR#4

- **T3.x** (PR#3): proactive outreach to decision-makers, `decision_alerta` gating/cooldown, `pending_alert_config` session reducer, opt-out keyword handler, M12 `is_first_alert` via `decision_alerta.ask_count`.
- **T4.x** (PR#4): cutover — remove dual-read, deprecate `SIGATOKA_UMBRAL_EE2_LEVE`, stop writing `sigatoka_umbrales` to `fincas.config`.

---

## Risks / Notes

- **Dual-read flag**: `ALERT_THRESHOLDS_DUAL_READ=true` required in prod during cutover window.
- **M12 is_first_alert**: Fully disabled in PR#2. `is_first_alert: false` unconditionally in pgBoss + `isFirstAlert = false` constant in alertaEntrega. PR#3 will implement via `decision_alerta.ask_count`.
- **Idempotency guard**: fail-open on DB error (log + proceed) — one missed mark is safer than one dropped quarantine alert (P7). The `markAlertaEntregada` dep is optional; when not injected, guard is skipped.
- **Non-Sigatoka delivery audience**: admins only for configured pests (design §5 ADR-F). Quarantine goes to admins + decision-makers.
- **forbidOnly CI**: Vitest `allowOnly: !isCI` means `.only` fails in CI. Not a bug.
- **Quarantine copy**: "Acción inmediata requerida" at threshold=1 needs agrónomo sign-off before first paying finca (P7/D29). Commented in `buildMensajeAlertaCuarentena`.

---

*Artifact store: hybrid*
*Change: configurable-alert-thresholds*
*Project: wasagro*
*Topic: sdd/configurable-alert-thresholds/apply-progress*
