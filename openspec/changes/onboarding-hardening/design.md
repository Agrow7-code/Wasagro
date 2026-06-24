# Design — onboarding-hardening

**Change:** `onboarding-hardening`
**Reads:** proposal + specs (onboarding-recovery, onboarding-terminal-paths, agricultor-approval, founder-alerts)
**Grounding:** verified against `OnboardingHandler.ts`, `procesarMensajeEntrante.ts`, `supabaseQueries.ts`, prompts `sp-04a/sp-04b`, and migrations 001/003/008/010 (2026-06-21).

---

## 0. Key grounding facts (verified, not assumed)

- **Routing gate is durable, session is ephemeral.** `procesarMensajeEntrante.ts:131` routes onboarding on `!usuario.onboarding_completo`. `sesiones_activas` has a 30-min TTL and is GC'd; `getOrCreateSession` (`supabaseQueries.ts:151`) resumes any session `.neq('status','completed')`. So when the handler marks the session `completed` at the step ceiling, the next message finds **no resumable session** → creates a fresh empty one → onboarding restarts from step 1. With `onboarding_completo` still false, this is an **infinite restart loop**, not a frozen limbo. ⇒ The terminal state MUST be durable on `usuarios`.
- **`clarification_count` is NOT constrained to ≤2 anymore.** Migration `010` dropped that CHECK (it only applied to the events/P2 flow). The onboarding handler overloads `clarification_count` as a step counter (`Math.min(pasoSiguiente, 10)`) — legal, no constraint bug.
- **`sesiones_activas.paso_onboarding` exists but is unused** (handler overloads `clarification_count`). Vestigial; out of scope to refactor (would add churn with no behavior change).
- **`usuarios.status`** ∈ `('activo','pendiente_aprobacion','inactivo')` (migration 008) — this is the **account-activation axis**, not onboarding progress. Do not overload it.
- **`usuarios.onboarding_completo`** is BOOLEAN — cannot express `requires_review`.
- **Consent reject path** today (`sp-04a/b` step 2 "FIN") sets no structured terminal; `datos_extraidos.consentimiento` is `boolean|null` and CAN carry `false`.
- **Founder channel already exists**: `FOUNDER_PHONE` env, used in `procesarMensajeEntrante.ts:88` + `handleFounderApproval`.

---

## 1. State model — the central decision

**Decision: add a durable column `usuarios.onboarding_estado`** (new axis), orthogonal to `onboarding_completo` and `status`.

```
onboarding_estado TEXT NOT NULL DEFAULT 'no_iniciado'
  CHECK (onboarding_estado IN (
    'no_iniciado',          -- created, never messaged
    'en_progreso',          -- actively onboarding
    'esperando_explicacion',-- data done; one-turn post-onboarding state (offer honored, §4)
    'completo',             -- finished OK (mirrors onboarding_completo=true)
    'requiere_revision',    -- step ceiling / attempt-limit → human intervention
    'rechazo_consentimiento'-- declined P6 → terminal, founder notified
  ));

-- Durable metrics breadcrumbs (sessions are GC'd, so capture here)
onboarding_iniciado_at   TIMESTAMPTZ   -- stamped on first en_progreso
onboarding_completado_at TIMESTAMPTZ   -- stamped on → completo
paso_trabado             INTEGER       -- step reached when → requiere_revision
```

**Why a new column, not a reuse:**
- `status` is the activation axis (`pendiente_aprobacion` is a *legitimate wait*, not a stuck onboarding — finding #5 explicitly separates them). Overloading it would conflate billing/activation with onboarding progress.
- `onboarding_completo` is boolean; it cannot represent the `requires_review` / `rechazo` terminals — which is the exact ambiguity that caused finding #1 (both OK-complete and ceiling-hit ended as session `completed`).

**Backward compatibility:** `onboarding_completo` stays the primary gate everywhere it is used today; `onboarding_estado` is authoritative only for the new stuck/terminal routing. On normal completion both are set (`completo` + `true`). This avoids touching `planGuard`, the deferred-trial trigger (client-provisioning), and other readers.

**Migration:** `20260621000064_add-onboarding-estado.sql` (064 — clears client-provisioning's reserved 062/063 and D32's 061). Adds the column with a safe default and backfills existing users: `onboarding_completo=true → 'completo'`, else `'en_progreso'` (conservative; nobody is retroactively marked stuck).

**Idempotency primitive — compare-and-set:** transitions into a terminal state are guarded by writing only when the current `onboarding_estado` differs from the target. This is the single source of idempotency for the founder alert (alert fires on the *transition*, not while already terminal), surviving pg-boss worker retries — the same monotonic discipline as the existing consent guard (`ctx0.consentimiento`).

---

## 2. Routing change (`procesarMensajeEntrante`)

Insert a terminal-state short-circuit **after `planGuard`** and **before** the `!usuario.onboarding_completo` onboarding block:

```
if (usuario.onboarding_estado is terminal-trouble) {  // requiere_revision | rechazo_consentimiento
   trace.event('onboarding_terminal_inbound')         // P4
   await _sender.enviarTexto(msg.from, holdingMessage(estado))  // at most one ack
   await actualizarMensaje(mensajeId, { status: 'processed' })
   return   // never re-route to onboarding (no restart) nor handleEvento
}
```

- `holdingMessage` is static copy ("Ya avisé a tu equipo, en breve te contactan ✅" / consent-declined close). No LLM call, no founder re-alert (the alert already fired on the transition).
- This is the structural fix for finding #1: the loop is cut at the durable gate, not the ephemeral session.

A second branch handles the non-terminal transient state **before** the `!onboarding_completo` block: if `onboarding_estado === 'esperando_explicacion'`, route to the post-onboarding branch (§4), not the normal step flow.

---

## 3. Recovery transition (`OnboardingHandler`, both flows)

Replace the current ceiling branch (`...pasoSiguiente >= MAX_ONBOARDING_STEPS → session 'completed'`) with:

- **Step ceiling OR attempt-limit reached and not complete** → set `usuarios.onboarding_estado = 'requiere_revision'` (compare-and-set), set session `status='fallback_nota_libre'` (already a valid enum value, migration 003 — semantically correct and *not* `completed`, so it is not silently resumed as fresh), send the holding message, emit `onboarding_stuck` (P4), and fire the founder alert (§6).
- **Structural P2 backstop (finding #6):** track per-step attempts. The current code already persists a monotonic counter; add an explicit "same step repeated N times without advancing" guard in `reduceOnboardingContext`/the handler so the transition does not depend on the LLM incrementing `siguiente_paso`. The ceiling (10) remains as the outer hard stop; the per-step limit (configurable, default aligned to P2 = 2) is the inner stop.

`MAX_ONBOARDING_STEPS` and the per-step attempt limit become named constants (env-overridable, e.g. `ONBOARDING_MAX_STEPS`, `ONBOARDING_MAX_STEP_ATTEMPTS`).

---

## 4. Activation dangling promise (#2) — Option B: one-turn post-onboarding state

**Decision: model a self-healing one-turn post-onboarding state that honors the explanation offer.** (Chosen over Option A "just remove the offer" because the agent should lead the user all the way to "here's how it works".)

**Activation turn** (data collection done): instead of `onboarding_completo=true`, set:
- `onboarding_completo = false` (so routing still goes to the onboarding flow, not `handleEvento`),
- `onboarding_estado = 'esperando_explicacion'`,
- send the completion + offer message ("…ya quedó todo ✅ ¿Quieres que te explique cómo funciona?").

**Next turn** — `procesarMensajeEntrante` routes `esperando_explicacion` to a small post-onboarding branch (not the step flow). The branch self-heals in exactly one turn via three cases:

1. **Affirmation** ("sí", "dale", "bueno") → send the how-it-works explanation → finalize (`onboarding_completo=true`, `onboarding_estado='completo'`, stamp `onboarding_completado_at`).
2. **Decline** ("no", "gracias") → brief warm close → finalize (same as above).
3. **Looks like a field report** (not a yes/no) → finalize FIRST, then **re-dispatch the same message to `handleEvento`** so it is processed exactly once and not swallowed.

**Yes/no detection:** cheap affirmation/negation keyword match (es: sí/dale/bueno/listo vs no/gracias/después). Ambiguity defaults to case 3 (finalize + treat as event) — the safest fall-through, since the user is already functionally onboarded and we must never eat a real report.

**Why this is not another finding #1:** the state lasts exactly one turn and ANY message finalizes it. `onboarding_completo` is never left false indefinitely; no timeout/worker needed. If the user never replies, their next message (whenever it comes) finalizes and is processed.

**Routing-order care (the sharp edge):** the re-dispatch in case 3 must finalize the user state *before* calling `handleEvento`, and must guard message idempotency (the inbound is already registered in `mensajes`; do not re-register). Covered explicitly in tasks + tests.

---

## 5. Consent rejection (#3)

- In both handlers, detect `datos.consentimiento === false` (the schema already allows it). On rejection: compare-and-set `onboarding_estado='rechazo_consentimiento'`, set session `status='fallback_nota_libre'`, send a warm close, emit `onboarding_consent_rejected` (P4), fire founder alert (§6).
- Prompts `sp-04a/sp-04b` step 2: keep the exact consent text (P6) and the warm "FIN" copy, but the **structured** signal (`consentimiento=false`) is what drives the durable terminal — not the prose. No field data retained beyond P6 allowance.

---

## 6. Founder alerts (#4 slice 1)

- **Helper `alertarFounder(reason, payload)`** (new, reusable): looks up `FOUNDER_PHONE`; if unset → emit `founder_alert_skipped` (P4) and return (best-effort, never throws, never blocks the terminal transition — per founder-alerts spec).
- Called from the three terminal transitions: `requiere_revision`, `rechazo_consentimiento`, and agricultor-approval escalation (§7).
- **Idempotency = the compare-and-set transition** (§1). The alert is emitted inside the same code path that performs the state transition, only when the state actually changes. Repeated inbound from an already-terminal user hits the §2 short-circuit (which does not alert).
- Message content: user phone/name, finca/org if known, reason. Plain text, ≤3 lines.
- **Queryable data (spec "Stuck-Onboarding Data Is Queryable"):** add `getOnboardingsTrabados()` to `supabaseQueries.ts` returning users in `requiere_revision`/`rechazo_consentimiento` plus long-pending `pendiente_aprobacion`, with timestamps/reason. Transport-agnostic so the future `/api/admin` endpoint (founder-backoffice) consumes it unchanged.

---

## 7. Agricultor approval resilience (#5)

**Decision: pg-boss scheduled worker (not lazy check).** A lazy check would only fire on inbound activity from the agricultor — who is blocked and likely silent — so it cannot reliably re-nudge. pg-boss already powers the SDR chaser (D24); reuse the pattern.

- New worker `approvalReminderWorker.ts` (or a scheduled job alongside existing pg-boss workers): periodically scans `usuarios` where `status='pendiente_aprobacion'` and the wait exceeds `APPROVAL_REMINDER_TIMEOUT`.
- **Tracking columns on `usuarios`** (same migration 064): `aprobacion_recordatorios INTEGER NOT NULL DEFAULT 0`, `ultimo_recordatorio_at TIMESTAMPTZ`. Bounded by `APPROVAL_MAX_REMINDERS` (default 2).
- Each cycle past the interval: re-notify the jefe/propietario (reuse `getJefeByFinca` + sender), increment counter, set `ultimo_recordatorio_at` (idempotent — not repeated before next interval).
- When `aprobacion_recordatorios >= APPROVAL_MAX_REMINDERS` and still pending: `alertarFounder('approval_escalation', …)` once, emit `agricultor_approval_timeout` (P4).
- `handleAprobacion` (existing) clears the agricultor from the scan by moving `status→'activo'`; no extra reset needed.

---

## 8. STT degradation (#7)

- In both handlers' audio branch (`OnboardingHandler.ts:76-94` / `209-227`): if transcription throws **or returns empty/whitespace**, send "No te entendí el audio, ¿lo escribís? ⚠️", emit `onboarding_stt_degraded` (P4), mark message processed, and **return without invoking the LLM and without advancing the step**. Today the empty `texto` silently flows into `onboardar*`.

---

## 9. Files touched (summary)

| File | Change |
|---|---|
| `supabase/migrations/20260621000064_add-onboarding-estado.sql` | NEW — `onboarding_estado` column + backfill + breadcrumb columns (`onboarding_iniciado_at`, `onboarding_completado_at`, `paso_trabado`) + approval-reminder tracking columns |
| `src/pipeline/procesarMensajeEntrante.ts` | terminal short-circuit before onboarding routing |
| `src/pipeline/handlers/OnboardingHandler.ts` | recovery transition, P2 backstop, consent-reject terminal, STT degradation, alert calls |
| `src/pipeline/supabaseQueries.ts` | `setOnboardingEstado` (compare-and-set), `getOnboardingsTrabados`, approval-reminder queries |
| `src/integrations/whatsapp/` (or shared) | `alertarFounder` reusable helper |
| `src/workers/approvalReminderWorker.ts` | NEW — pg-boss scan + re-nudge + escalation |
| `prompts/sp-04a-onboarding-admin.md` | remove dangling activation offer |
| `prompts/sp-04b-onboarding-agricultor.md` | consent-reject close copy (structured signal already exists) |
| `src/types/dominio/Onboarding.ts` | (if needed) keep schema; no breaking change |

Constants/env: `ONBOARDING_MAX_STEPS`, `ONBOARDING_MAX_STEP_ATTEMPTS`, `APPROVAL_REMINDER_TIMEOUT`, `APPROVAL_MAX_REMINDERS`.

---

## 10. Risks / open points carried to tasks

1. **Backfill conservatism:** existing in-flight onboardings are backfilled to `en_progreso`, not `requiere_revision`; they continue normally. Acceptable — no retroactive stuck-marking.
2. **pg-boss worker registration:** confirm the scheduling mechanism used by existing workers (cron vs. interval) and register the reminder job consistently.
3. **Migration numbering coordination:** 064 assumes client-provisioning (062/063) lands first or independently; timestamps (`20260621…`) order correctly regardless, but verify no parallel branch also claims 064.
4. **Holding-message tone:** copy must follow prompt voice rules (tuteo, ≤3 lines, only ✅/⚠️) even though it is static (not LLM).
5. **Test seams:** `alertarFounder`, `setOnboardingEstado`, and the reminder worker need injectable deps (sender/clock) for unit tests — strict TDD applies.
6. **`shouldSuppressOnboardingForActiveSDR` interplay:** the new terminal short-circuit runs only for existing `usuarios`; SDR suppression already gates the `!onboarding_completo` block. Confirm the short-circuit sits where it cannot hijack an active SDR pitch.
