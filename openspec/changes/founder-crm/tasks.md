# Tasks: founder-crm — per-conversation human takeover (slices 1→4)

Scope: PR1 (data model + pause/resume gate + chaser suppression — the operable
core), PR2 (inbox read), PR3 (send from panel), PR4 (frontend). `handleFounderApproval`
stays live throughout (Decision 6) — not replaced here. Test framework: vitest.
Type-check: `tsc --noEmit`. Delivery: chained PRs, PR1→PR2→PR3→PR4 (chain strategy
not yet chosen by the user — see forecast below).

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1 ~470 · PR2 ~320 · PR3 ~165 · PR4 ~375 (≈1330 total across all 4) |
| 400-line budget risk | High (PR1 and PR4 individually near/over budget) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 (already fixed by scope instructions) |
| Delivery strategy | not provided at launch — treat as `ask-on-risk` default |
| Chain strategy | pending — orchestrator must ask (stacked-to-main vs feature-branch-chain) |

Chained PRs recommended: Yes
400-line budget risk: High

### Delivery decisions (locked by user)
- **Chain strategy:** stacked-to-main (each PR merges to `main` in order).
- **PR1 split into two** to stay under the 400-line budget:
  - **PR1a** = T-H1.0 → T-H1.5 (migration + query helpers + gate handler + pipeline wiring + chaser guard). Auto-pause works; manual resume lands in PR1b.
  - **PR1b** = T-H1.6 (manual pause/resume routes).
- **Delivery order:** PR1a → PR1b → PR2 → PR3 → PR4 (strict TDD; 4R review on security-path PRs before merge).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Data model + pause/resume gate + auto-pause + chaser suppression + manual pause/resume routes | PR1 | Operable core; ~470 LOC is the largest slice — see PR1 forecast and Open Item #1 below for a further-split option if strict budget adherence is required |
| 2 | Inbox read (list + thread) | PR2 | Depends on PR1's `handoff_status`/`handoff_reason` columns and `sdr_prospectos` shape |
| 3 | Send from panel | PR3 | Depends on PR2's `:id`-addressed router surface existing; reuses `crearSenderWhatsApp()` as-is |
| 4 | Frontend Inbox UI + badge | PR4 | Depends on PR2 (list/thread) + PR3 (send) endpoints existing |

---

## Verified codebase facts (locked before tasks)

- `procesarMensajeEntrante.ts` `!usuario` branch (lines 96-100): `if (!usuario) { const meetingHandled = await handleMeetingConfirmation(...); if (meetingHandled) return; await handleSDRSession(...); return }`. The gate MUST be inserted as the first statement inside this block, before `handleMeetingConfirmation`.
- `detectarHandoffTrigger` (`sdrAgent.ts:64`) is defined and exported but **currently invoked nowhere in the codebase** (confirmed via grep — 0 call sites, 0 test coverage). PR1's gate is the first real caller. Not a blocker — matches design Decision 3 exactly — but note this so nobody assumes handoff-by-text is already live.
- `sdr_interacciones.tipo` CHECK constraint (as of migration `20260101000027_fix-sdr-interacciones-constraints.sql`, latest to touch `tipo`) allows: `inbound`, `outbound`, `draft_approval`, `founder_override`, `meeting_confirmation`. No later migration extends `tipo`.
- `sdr_interacciones.action_taken` is nullable (CHECK constraints permit NULL in Postgres) — confirmed no NOT NULL on that column in `20260101000013_add-sdr-interacciones.sql`.
- **Panel send tipo decision**: reuse the already-allowed `tipo='founder_override'` (its existing meaning per migration 045's comment — "the founder replies with custom text ... forwarded to the prospect as-is" — is exactly a panel-driven manual reply) with `action_taken=null`. **Zero new migration needed for PR3.**
- `mensajes_entrada` has no `prospecto_id` and no `direction` column — every row in this table is inbound-only, keyed by `phone`. Join to a conversation thread by `phone`, not FK.
- `crearSenderWhatsApp()` (`src/integrations/whatsapp/index.ts:36-39`) **already** wraps the inner sender in `CostTrackedSender` — confirmed by reading the source. The send route must call `crearSenderWhatsApp()` directly (same as `sdrChaserWorker.ts` does), no explicit wrap needed. **Resolves the design's Open Question.**
- **Cost-tracking gap (accept, do not silently overclaim)**: `CostTrackedSender#recordCost` resolves org/finca via `usuarios` table lookup by phone (`resolvePhoneContext`) and early-returns (no insert) when both are null. SDR prospects have no `usuarios` row, so **no `wa_message_costs` row is written** for any SDR-directed send — this is pre-existing behavior, identical to today's `sdrChaserWorker.ts` sends. PR3 reuses the cost-tracked sender for D27 infra parity, but the spec scenario's "a cost record is written (D27)" will NOT literally happen for SDR conversations today. Flag as spec-vs-code drift in the apply report (do not attempt to fix org-less cost attribution in this change — out of scope).
- `handleSDRSession` ends every branch with `await actualizarMensaje(mensajeId, { status: 'processed' })` — the gate must do the same when it short-circuits, to stay consistent with the rest of the `!usuario` branch.
- `AdminLayout.tsx` / `ClientList.tsx` establish the frontend fetch/auth pattern (`authFetch`, `VITE_API_URL` base, loading/error/data states) — PR4 reuses this exactly, no new infra.
- Next migration prefix: `20260701000078` (last is `20260626000077_add-alerta-plaga-entregada-at.sql`).
- Test file convention confirmed: flat `tests/pipeline/*.test.ts` (no `handlers/` subfolder even though `src/pipeline/handlers/` exists), `tests/workers/*.test.ts`, `tests/agents/admin/router.*.test.ts`, `landing/tests/admin/*.test.tsx`.

---

## PR1 — Data model + pause/resume gate + chaser suppression (slices 1+2)

**Branch**: `feat/founder-crm-handoff-gate`
**Target**: `main`
**~470 LOC estimated. Budget: High — see Open Item #1.**

### VERIFY-FIRST

#### T-H1.0 — [VERIFY] Re-confirm gate insertion point before coding
**Status**: ✅ DONE (PR1a) — re-read at apply time; the `!usuario` branch was unchanged (still lines 96-101, gate call inserted as first statement, before `handleMeetingConfirmation`).
**Scope**: Research only.
**Files**: `src/pipeline/procesarMensajeEntrante.ts`.
**Work**: Re-read the `!usuario` branch immediately before writing T-H1.3 — the file may have shifted since this tasks doc was written (line ~96). Confirm the gate call is the FIRST statement inside `if (!usuario) { ... }`, strictly before `handleMeetingConfirmation`.
**Failing test pairing**: none (verify task); T-H1.3's regression test in `procesarMensajeEntrante.test.ts` encodes the confirmed wiring.
**Spec**: REQ-hand-008.

---

### Commit 1 — Data model (work unit: additive migration + query helpers)

#### T-H1.1 — Create migration adding handoff columns to `sdr_prospectos`
**Status**: ✅ DONE (PR1a) — `20260701000078_add-handoff-state-sdr-prospectos.sql`.
**Scope**: New file.
**Files**: `supabase/migrations/20260701000078_add-handoff-state-sdr-prospectos.sql` (create).
**Work**:
- `ALTER TABLE sdr_prospectos ADD COLUMN handoff_status TEXT NOT NULL DEFAULT 'bot' CHECK (handoff_status IN ('bot','human_paused'))`.
- `ADD COLUMN handoff_reason TEXT CHECK (handoff_reason IN ('manual','auto_human_request'))`.
- `ADD COLUMN handoff_paused_at TIMESTAMPTZ`, `handoff_resumed_at TIMESTAMPTZ`, `handoff_last_pinged_at TIMESTAMPTZ`.
- `CREATE INDEX idx_sdr_prospectos_handoff_paused ON sdr_prospectos (id) WHERE handoff_status = 'human_paused'` (partial index).
- No RLS change — inherits the existing `sdr_prospectos_service_only` `FOR ALL` policy.
**Failing test pairing**: none (schema-only, additive, `DEFAULT 'bot'`-safe); verified indirectly by T-H1.2's test selecting the new columns.
**Spec**: REQ-hand-007.

#### T-H1.2 — Add `getHandoffEstado` / `setHandoffEstado` to `supabaseQueries.ts`
**Status**: ✅ DONE (PR1a) — TDD RED→GREEN, 3/3 tests green.
**Scope**: Modify existing file.
**Files**: `src/pipeline/supabaseQueries.ts` (modify), `tests/pipeline/supabaseQueries.handoff.test.ts` (create, test-first).
**Depends on**: T-H1.1.
**Work**:
- Write failing tests first: `getHandoffEstado(phone)` selects exactly `id, handoff_status, handoff_last_pinged_at, turns_total` filtered by `phone`, returns `null` on no row; `setHandoffEstado(id, updates)` issues an `.update(updates).eq('id', id)`.
- Implement `getHandoffEstado(phone: string, client?): Promise<Record<string, unknown> | null>` — single indexed lookup, minimal columns (P3 — do not `select('*')`, that's `getSDRProspecto`'s job).
- Implement `setHandoffEstado(id: string, updates: Record<string, unknown>, client?): Promise<void>`.
**Failing test pairing**: `tests/pipeline/supabaseQueries.handoff.test.ts`.
**Spec**: REQ-hand-007, REQ-hand-008 (design Decision 2).

---

### Commit 2 — Gate handler (work unit: the pause/auto-pause core)

#### T-H1.3 — Create `src/pipeline/handlers/HandoffGateHandler.ts`
**Status**: ✅ DONE (PR1a) — TDD RED→GREEN, 6/6 tests green (5 cases + price_readiness inert case).
**Scope**: New file.
**Files**: `src/pipeline/handlers/HandoffGateHandler.ts` (create), `src/integrations/whatsapp/founderAlerts.ts` (modify — add reason), `tests/pipeline/HandoffGateHandler.test.ts` (create, test-first).
**Depends on**: T-H1.2.
**Work**:
- Add `'sdr_handoff_solicitado'` to `FounderAlertReason` union + a `TITULOS` entry in `founderAlerts.ts` (e.g. `'⚠️ Prospecto pidió hablar con una persona'`).
- Write failing tests first, covering `handleHandoffGate(msg, mensajeId, traceId, sender): Promise<boolean>`:
  1. No prospecto row exists (`getHandoffEstado` → `null`) → returns `false`, no writes (first-turn messages always fall through — design Decision 2 scopes the gate to "if a prospecto exists").
  2. `handoff_status === 'human_paused'` → logs an `sdr_interacciones` row (`tipo='inbound'`), calls `actualizarMensaje(mensajeId, {status:'processed'})`, does NOT call any FSM/LLM, does NOT send a founder ping (ping already happened at the pause transition — see case 3), returns `true`.
  3. `handoff_status === 'bot'` and `detectarHandoffTrigger(texto, turno)` returns `'human_request'` → `setHandoffEstado` flips to `human_paused` / `auto_human_request` with `handoff_paused_at` + `handoff_last_pinged_at` both set now, logs `sdr_interacciones` (`tipo='inbound'`), sends ONE graceful ack via `sender.enviarTexto`, calls `alertarFounder('sdr_handoff_solicitado', {...})` exactly once, marks the message `processed`, returns `true`.
  4. `handoff_status === 'bot'` and trigger is `null`/`price_readiness` → returns `false` (falls through to `handleMeetingConfirmation`/`handleSDRSession` unchanged; `price_readiness` stays inert per design Decision 3).
  5. Regression: 3 consecutive inbound messages while `human_paused` → exactly ONE `alertarFounder` call total across the whole sequence (asserted via a repeated-call harness, not just a single-call check).
- Implement per the above; `texto` extraction mirrors `handleSDRSession` (`msg.tipo === 'texto' ? (msg.texto ?? '') : '[mensaje de voz o imagen]'`); `turno` = `(estado.turns_total ?? 0) + 1`.
- Copy for the graceful ack MUST follow CLAUDE.md voice rules (tuteo, ≤3 lines, only ✅/⚠️ emoji, no forbidden vocabulary).
**Failing test pairing**: `tests/pipeline/HandoffGateHandler.test.ts` (5 cases above).
**Spec**: REQ-hand-001 (human_request scenario), REQ-hand-008 (all 3 scenarios).

#### T-H1.4 — Wire the gate into `procesarMensajeEntrante.ts`
**Status**: ✅ DONE (PR1a) — TDD RED→GREEN, 3/3 tests green including the mandatory field-path regression (case c).
**Scope**: Modify existing file (surgical — one import, one call).
**Files**: `src/pipeline/procesarMensajeEntrante.ts` (modify), `tests/pipeline/procesarMensajeEntrante.test.ts` (modify — add cases, test-first).
**Depends on**: T-H1.3, T-H1.0 (re-verified insertion point).
**Work**:
- Write failing tests first: (a) `handleHandoffGate` returning `true` short-circuits before `handleMeetingConfirmation`/`handleSDRSession` are called; (b) `handleHandoffGate` returning `false` falls through to the existing `handleMeetingConfirmation`→`handleSDRSession` chain unchanged; (c) **regression** — a message from a phone with a `usuarios` row (field-capture path) never calls `getHandoffEstado`/`handleHandoffGate` at all (spy assertion — REQ-hand-011).
- Insert `const gateHandled = await handleHandoffGate(msg, mensajeId, traceId, _sender!); if (gateHandled) return` as the first statement inside `if (!usuario) { ... }`, before `handleMeetingConfirmation`.
- Do NOT touch the `usuario` branch (`handleEvento` call) in any way.
**Failing test pairing**: `tests/pipeline/procesarMensajeEntrante.test.ts` (3 cases above, including the mandatory field-path regression).
**Spec**: REQ-hand-008, REQ-hand-011.

---

### Commit 3 — Chaser suppression (work unit: D24 skip guard)

#### T-H1.5 — Add paused-state skip guard to `sdrChaserWorker.ts`
**Status**: ✅ DONE (PR1a) — TDD RED→GREEN, new case green + all 9 existing cases in the file still pass.
**Scope**: Modify existing file.
**Files**: `src/workers/sdrChaserWorker.ts` (modify), `tests/workers/sdrChaserWorker.test.ts` (modify — add case, test-first).
**Depends on**: T-H1.1 (column exists).
**Work**:
- Write failing test first: prospecto fetched fresh with `handoff_status: 'human_paused'` → chaser returns without calling `crearSenderWhatsApp()`/`saveSDRInteraccion`, logs a `chaser_skipped_paused` trace event.
- Insert the guard in `sdrChaserHandler` after the not-found/turns_total checks, alongside the existing advanced-status and already-booked skips: `if (prospecto['handoff_status'] === 'human_paused') { trace.event({ name: 'chaser_skipped_paused', level: 'DEFAULT' }); return }`.
- Confirm (already true by construction) that `getSDRProspectoById` reads fresh at execution time — no enqueue-time snapshot — so a chaser enqueued before the pause still aborts.
**Failing test pairing**: `tests/workers/sdrChaserWorker.test.ts` (new case).
**Spec**: REQ-hand-010.

---

### Commit 4 — Manual pause/resume routes (work unit: founder-initiated takeover)

#### T-H1.6 — Add `POST /conversaciones/:id/pause` and `/resume` to `adminRouter`
**Scope**: New route block in existing file.
**Files**: `src/agents/admin/router.ts` (modify), `tests/agents/admin/router.conversaciones.pause.test.ts` (create, test-first).
**Depends on**: T-H1.2 (`setHandoffEstado`).
**Work**:
- Write failing tests first:
  1. `director` POST `/conversaciones/:id/pause` (no body) → `handoff_status='human_paused'`, `handoff_reason='manual'`, `handoff_paused_at` set; response 200; `alertarFounder` NOT called (founder already knows — they triggered it).
  2. `director` POST `/conversaciones/:id/resume` → `handoff_status='bot'`, `handoff_resumed_at` set, `handoff_reason=null`, `handoff_last_pinged_at=null`; response 200; next inbound routes through the normal FSM (asserted at the query-shape level, not end-to-end).
  3. Non-`director` on either route → 403, `setHandoffEstado` NOT called.
  4. Unknown `:id` → 404 (no ambiguity requirement here — that's scoped to READ endpoints only, see Open Item #2).
- Implement both routes addressed by prospecto UUID `:id` (never `:phone`), gated by the router's existing `roleGuard` mount.
**Failing test pairing**: `tests/agents/admin/router.conversaciones.pause.test.ts` (4 cases above).
**Spec**: REQ-hand-008 (manual pause scenario), REQ-hand-009 (both scenarios).

---

## PR1 Review Workload Forecast

| Metric | Estimate |
|---|---|
| Changed lines | ~470 LOC (migration + 2 query fns + gate handler + wiring + chaser guard + 2 routes, all with tests) |
| 400-line budget risk | **High** |
| Chained PRs recommended | Already the smallest coherent operable slice per the given scope; see Open Item #1 for a further split option |
| Security path touched | YES — new director-only routes, `handoff_status` gates an entire message class |
| 4R review required | **YES** (update path + new admin route → pre-PR 4R fan-out) |
| Decision needed before apply | Yes — confirm with the user whether to accept `size:exception` for PR1 or further split per Open Item #1 |
| Migrations | 1 (`20260701000078_...`) |

---

## PR2 — Inbox read (slice 3)

**Branch**: `feat/founder-crm-inbox-read`
**Target**: `main` (after PR1 merged — needs `handoff_status`/`handoff_reason` columns)
**~320 LOC estimated. Budget: Medium.**

### VERIFY-FIRST

#### T-H2.0 — [VERIFY] Confirm merge shape for `mensajes_entrada` + `sdr_interacciones`
**Status**: Already confirmed during this tasks pass (see "Verified codebase facts") — `mensajes_entrada` has no `prospecto_id`, join by `phone`; `sdr_interacciones.tipo` enum is `inbound|outbound|draft_approval|founder_override|meeting_confirmation`. Re-confirm at apply time only if the schema has changed since.
**Failing test pairing**: none; T-H2.2's test encodes the confirmed shape.
**Spec**: founder-inbox → "Conversation thread read".

---

### Commit 5 — List + thread query helpers

#### T-H2.1 — Add `getConversacionesList()` to `supabaseQueries.ts`
**Scope**: Modify existing file.
**Files**: `src/pipeline/supabaseQueries.ts` (modify), `tests/pipeline/supabaseQueries.conversaciones.test.ts` (create, test-first).
**Work**:
- Write failing test first: single query against `sdr_prospectos` selecting `id, phone, nombre, empresa, status, handoff_status, handoff_reason, founder_notified_at, ultima_interaccion`, ordered by `ultima_interaccion DESC` — asserted as ONE round-trip (no per-row query).
- Implement `getConversacionesList(client?): Promise<Array<Record<string, unknown>>>`.
**Failing test pairing**: `tests/pipeline/supabaseQueries.conversaciones.test.ts` (list case).
**Spec**: founder-inbox → "Conversation list".

#### T-H2.2 — Add `getConversacionThread(prospectoId)` to `supabaseQueries.ts`
**Scope**: Modify existing file.
**Files**: `src/pipeline/supabaseQueries.ts` (modify), `tests/pipeline/supabaseQueries.conversaciones.test.ts` (extend).
**Depends on**: T-H2.1 (same file/commit; can pair).
**Work**:
- Write failing tests first: (a) known id → fetches prospecto by id for `phone`, queries `mensajes_entrada` (`eq('phone', ...)`, order `created_at asc`) and `sdr_interacciones` (`eq('prospecto_id', ...)`, order `created_at asc`), merges both into one array sorted by `created_at`, each item tagged with its source (`origen: 'mensajes_entrada' | 'sdr_interacciones'`); (b) unknown id → prospecto lookup returns `null` → function returns `[]`, no error thrown.
- Implement `getConversacionThread(prospectoId: string, client?): Promise<Array<Record<string, unknown>>>`.
**Failing test pairing**: `tests/pipeline/supabaseQueries.conversaciones.test.ts` (thread cases).
**Spec**: founder-inbox → "Conversation thread read" (both scenarios).

---

### Commit 6 — Read routes

#### T-H2.3 — Add `GET /conversaciones` to `adminRouter`
**Scope**: New route block in existing file.
**Files**: `src/agents/admin/router.ts` (modify), `tests/agents/admin/router.conversaciones.test.ts` (create, test-first).
**Depends on**: T-H2.1.
**Work**:
- Write failing tests first: 5 conversations, 2 `handoff_status='human_paused'` → 200, all 5 returned, `needs_attention=true` on exactly the 2 paused rows (and on any row with `founder_notified_at` set); every `phone` in the response is `maskPhone`-masked; non-director → 403, no rows returned.
- Implement: `needs_attention = handoff_status === 'human_paused' || founder_notified_at != null`.
**Failing test pairing**: `tests/agents/admin/router.conversaciones.test.ts`.
**Spec**: founder-inbox → "Conversation list" (both scenarios).

#### T-H2.4 — Add `GET /conversaciones/:id/mensajes` to `adminRouter`
**Scope**: New route block in existing file.
**Files**: `src/agents/admin/router.ts` (modify), `tests/agents/admin/router.conversaciones.mensajes.test.ts` (create, test-first).
**Depends on**: T-H2.2.
**Work**:
- Write failing tests first: known id with 6 interactions → 200, chronological order, any embedded phone masked; unknown id → 200 with `[]` (never 404/500); non-director → 403.
**Failing test pairing**: `tests/agents/admin/router.conversaciones.mensajes.test.ts`.
**Spec**: founder-inbox → "Conversation thread read"; "Isolation and non-enumeration" (uniform-response scenario).

---

## PR2 Review Workload Forecast

| Metric | Estimate |
|---|---|
| Changed lines | ~320 LOC |
| 400-line budget risk | **Medium** |
| Chained PRs recommended | No further split needed within PR2 |
| Security path touched | Moderate — read-only, but PII (phone) surfaces — masking is load-bearing |
| 4R review required | Recommended (phone-masking correctness is a real regression risk) |
| Decision needed before apply | No |
| Migrations | None |

---

## PR3 — Send from panel (slice 4)

**Branch**: `feat/founder-crm-send`
**Target**: `main` (after PR2 merged)
**~165 LOC estimated. Budget: Low.**

### VERIFY-FIRST

#### T-H3.0 — [VERIFY] Sender factory + cost-tracking + tipo enum — already resolved
**Status**: Resolved during this tasks pass (see "Verified codebase facts"): `crearSenderWhatsApp()` already wraps `CostTrackedSender` (no explicit wrap); no `wa_message_costs` row will be written for SDR phones (pre-existing, accepted, flag as spec-drift in apply report); reuse `tipo='founder_override'` + `action_taken=null` — zero new migration.
**Failing test pairing**: none; T-H3.2's tests encode all three decisions.
**Spec**: founder-inbox → "Send message from panel".

---

### Commit 7 — Send route

#### T-H3.1 — Add `getSDRProspectoById(id)` to `supabaseQueries.ts`
**Scope**: Modify existing file.
**Files**: `src/pipeline/supabaseQueries.ts` (modify), `tests/pipeline/supabaseQueries.conversaciones.test.ts` (extend).
**Work**:
- Write failing test first: known id → returns the full row; unknown id → returns `null` (no throw).
- Implement `getSDRProspectoById(id: string, client?): Promise<Record<string, unknown> | null>` — `select('*').eq('id', id).maybeSingle()`. Do NOT touch `sdrChaserWorker.ts`'s private duplicate of this same query — out of scope for this change (same restraint as `maskPhone` not being retrofitted everywhere).
**Failing test pairing**: `tests/pipeline/supabaseQueries.conversaciones.test.ts` (extend).
**Spec**: founder-inbox → "Send message from panel" (phone resolution).

#### T-H3.2 — Add `POST /conversaciones/:id/enviar` to `adminRouter`
**Scope**: New route block in existing file.
**Files**: `src/agents/admin/router.ts` (modify), `tests/agents/admin/router.conversaciones.enviar.test.ts` (create, test-first).
**Depends on**: T-H3.1.
**Work**:
- Write failing tests first:
  1. `director` sends a valid `{ mensaje: string }` body to a known `:id` → `crearSenderWhatsApp().enviarTexto(resolvedPhone, mensaje)` called; `saveSDRInteraccion` called with `{ prospecto_id: id, phone, turno: prospecto.turns_total, tipo: 'founder_override', contenido: mensaje, action_taken: null }`; response 200; the raw phone number does NOT appear anywhere in the JSON response body.
  2. Non-`director` → 403; sender NOT called.
  3. Conversation `handoff_status='human_paused'` → send still succeeds (200), `handoff_status` is left completely unchanged (no auto-resume — assert `setHandoffEstado`/`handoff_status` update NOT called).
  4. Empty/missing `mensaje` in body → 400, sender NOT called.
  5. Unknown `:id` → 404 (send is an action, not a read — see Open Item #2 for why this differs from the read endpoints' 200-empty convention).
- Implement: `Zod` body validation (`mensaje: z.string().min(1)`); resolve phone via `getSDRProspectoById`; call `crearSenderWhatsApp()` directly (already cost-tracked per T-H3.0); persist via `saveSDRInteraccion`.
**Failing test pairing**: `tests/agents/admin/router.conversaciones.enviar.test.ts` (5 cases above).
**Spec**: founder-inbox → "Send message from panel" (all 3 scenarios).

---

## PR3 Review Workload Forecast

| Metric | Estimate |
|---|---|
| Changed lines | ~165 LOC |
| 400-line budget risk | **Low** |
| Chained PRs recommended | No |
| Security path touched | YES — outbound WhatsApp send gated by roleGuard; phone must never leak in the response |
| 4R review required | Recommended (send path + PII) |
| Decision needed before apply | No |
| Migrations | None |

---

## PR4 — Frontend Inbox UI + badge (slice 4 UI)

**Branch**: `feat/founder-crm-inbox-ui`
**Target**: `main` (after PR2 + PR3 merged — needs both endpoint sets)
**~375 LOC estimated. Budget: Medium-High.**

### Commit 8 — Inbox view

#### T-H4.1 — Create `landing/src/admin/Inbox.tsx`
**Scope**: New file.
**Files**: `landing/src/admin/Inbox.tsx` (create), `landing/tests/admin/Inbox.test.tsx` (create, test-first).
**Work**:
- Write failing tests first:
  1. `GET /conversaciones` returns 3 rows → list pane renders 3 rows, `needs_attention` rows visually flagged.
  2. Clicking a row fetches `GET /conversaciones/:id/mensajes` and renders the thread pane in chronological order.
  3. Pause/resume button calls the corresponding `POST` route and reflects the new state without a full page reload.
  4. Send box: typing a message + submit calls `POST /conversaciones/:id/enviar`; input clears on success; API error → inline error, input NOT cleared.
- Implement: list pane + thread pane + pause/resume button + send box, reusing the `authFetch`/`VITE_API_URL` pattern from `ClientList.tsx` (loading/error/data states).
**Failing test pairing**: `landing/tests/admin/Inbox.test.tsx` (4 cases above).
**Spec**: design Decision 7.

---

### Commit 9 — Nav + badge

#### T-H4.2 — Wire `/admin/inbox` route + nav badge in `AdminLayout.tsx`
**Scope**: Modify existing files.
**Files**: `landing/src/App.tsx` (modify — add route), `landing/src/admin/AdminLayout.tsx` (modify — nav entry + badge), `landing/tests/admin/inboxBadge.test.tsx` (create, test-first).
**Depends on**: T-H4.1.
**Work**:
- Write failing tests first: nav renders an "Inbox" link; badge shows the count of `handoff_status='human_paused'` conversations, refreshed on a polling interval (no websockets); badge hidden/zero when no conversations are paused.
- Implement: add `{ to: '/admin/inbox', label: 'Inbox' }` to `NAV_LINKS`; poll `GET /conversaciones` on an interval, derive the paused count, render as a badge next to the nav link.
**Failing test pairing**: `landing/tests/admin/inboxBadge.test.tsx`.
**Spec**: design Decision 7.

---

## PR4 Review Workload Forecast

| Metric | Estimate |
|---|---|
| Changed lines | ~375 LOC |
| 400-line budget risk | **Medium-High** (close to budget as a single PR) |
| Chained PRs recommended | Could split T-H4.1 (Inbox.tsx) from T-H4.2 (nav+badge) into 2 PRs if reviewer load is a concern |
| Security path touched | No (consumes already-gated endpoints; no new auth logic) |
| 4R review required | Not required (no auth/update/security/payments path; readability review sufficient) |
| Decision needed before apply | No |
| Migrations | None |

---

## Dependency Order

```
T-H1.0 (verify insertion point) ─┐
T-H1.1 (migration)               ├─► T-H1.2 (query helpers) ─► T-H1.3 (gate handler) ─► T-H1.4 (wire into pipeline)
                                  │                                                    └─► T-H1.5 (chaser guard, parallel with T-H1.4)
                                  └─► T-H1.6 (pause/resume routes, parallel with T-H1.3-1.5)

[PR1 merged]

T-H2.0 (verify merge shape) ─► T-H2.1 (list query) ─► T-H2.3 (GET /conversaciones)
                             └─► T-H2.2 (thread query) ─► T-H2.4 (GET /:id/mensajes)

[PR2 merged]

T-H3.0 (verify) ─► T-H3.1 (getSDRProspectoById) ─► T-H3.2 (POST /:id/enviar)

[PR3 merged]

T-H4.1 (Inbox.tsx) ─► T-H4.2 (nav + badge)
```

Parallel clusters:
- **PR1**: T-H1.5 (chaser guard) and T-H1.6 (pause/resume routes) can be written in parallel with T-H1.3/T-H1.4 once T-H1.1/T-H1.2 land.
- **PR2**: T-H2.1/T-H2.3 and T-H2.2/T-H2.4 are independent pairs — can be split across 2 people.
- **PR3, PR4**: linear, single-threaded.

---

## Open Items Flagged from Design

1. **PR1 exceeds the 400-line budget as a single PR (~470 LOC)**. The given scope
   bundles migration + gate + auto-pause + chaser guard + manual pause/resume
   routes as "the operable core" for a reason — a partial PR1 (e.g. migration +
   gate only, deferring manual pause/resume routes to a PR1b) would ship a
   pause mechanism the founder cannot yet resume by hand, which is worse than
   accepting `size:exception` for PR1. Recommend `size:exception` over a further
   split, but this is the user's call — surfaced via the guard above.
2. **Send-to-unknown-`:id` returns 404** (T-H3.2, case 5), which differs from
   the read endpoints' "200 + empty list" non-enumeration convention. The spec's
   non-enumeration requirement is scoped to reads ("error responses MUST NOT
   reveal whether a given `:id` exists versus is simply empty") — a send is an
   action with an unambiguous target, not a read, so 404 does not leak
   information a director doesn't already have (they picked `:id` from a list
   they can already see). Flag in the apply report; revisit if this reasoning
   is wrong.
3. **`detectarHandoffTrigger` was dead code before this change** — PR1 is its
   first real caller. Confirmed via full-repo grep (0 other call sites, 0 test
   files). Not a blocker, but a discovery worth a mention in the apply report
   Vs. the spec's phrasing that suggests the trigger logic was already partially
   wired.
