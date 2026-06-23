# Tasks — onboarding-hardening

**Strict TDD:** active. Every behavior task is test-first (write failing test → implement → green). Test runner: project test command.
**Reads:** proposal, design, specs/*.
**Delivery:** see Review Workload Forecast at the bottom.

Work units are ordered by dependency. Each is an independently reviewable slice.

---

## WU1 — State foundation (schema + primitive) ✅ DONE (PR-A)

- [x] 1.1 Migration `supabase/migrations/20260621000064_add-onboarding-estado.sql` — column + CHECK (6 values), breadcrumbs, approval tracking, conservative backfill, partial index.
- [x] 1.2 TEST: `setOnboardingEstado` compare-and-set — transitioned true/false, per-target stamping, error propagation (`tests/pipeline/onboardingEstado.test.ts`, 6 tests).
- [x] 1.3 Implement `setOnboardingEstado` in `supabaseQueries.ts` (`.neq` compare-and-set; stamps land once because the write only fires on a real transition).
- [x] 1.4 Extend `UsuarioRow` + add `OnboardingEstado`/`OnboardingTrabadoRow` types; no breaking change to `onboarding_completo` readers (verified by full typecheck + existing suite green).

## WU2 — Founder alert helper (dependency for WU3/WU4/WU7) ✅ DONE (PR-A)

- [x] 2.1 TEST: `alertarFounder` — sends to injected `FOUNDER_PHONE`; unset → no-op `{sent:false}` without throwing (`tests/integrations/whatsapp/founderAlerts.test.ts`).
- [x] 2.2 Implement `alertarFounder` + `construirMensajeFounder` in `src/integrations/whatsapp/founderAlerts.ts` (lazy sender import so it stays importable in isolation).
- [x] 2.3 TEST: send failure is swallowed (best-effort, never blocks). Transition-based idempotency primitive is `setOnboardingEstado().transitioned` (tested in 1.2); wiring into handlers lands in PR-B.

## WU3 — Recovery & P2 backstop (#1, #6) ✅ DONE (PR-B)

- [x] 3.1 TEST: step ceiling → `requiere_revision` + founder alert + holding (`onboardingHandler.recovery.test.ts`).
- [x] 3.2 TEST: P2 backstop via reducer `clarificationTurnsUsed >= max` → stuck even if LLM didn't advance (`onboardingOutcome.test.ts`).
- [x] 3.3 TEST: terminal short-circuit pure check `esEstadoOnboardingTerminal` (`onboardingOutcome.test.ts`); routing wired in `procesarMensajeEntrante`.
- [x] 3.4 Implement: `decidirDesenlaceOnboarding` + `finalizarOnboardingTrabado` in both flows; constants in `onboardingOutcome.ts` (env-overridable).
- [x] 3.5 Implement: terminal short-circuit in `procesarMensajeEntrante` after `planGuard`, before `!onboarding_completo`.

## WU4 — Activation Option B: one-turn post-onboarding state (#2)  ⟶ PR-C

- [ ] 4.1 TEST: activation turn sets `esperando_explicacion` + `onboarding_completo=false`, sends offer; next message routes to the post-onboarding branch (not `handleEvento`).
- [ ] 4.2 TEST: affirmation → explanation sent → finalize (`completo`+`true`, `onboarding_completado_at` stamped).
- [ ] 4.3 TEST: decline → warm close → finalize.
- [ ] 4.4 TEST: field-report message → finalize FIRST, then dispatched to `handleEvento`, processed exactly once (no re-register of the inbound, no duplication).
- [ ] 4.5 Implement the post-onboarding branch + yes/no keyword detector (ambiguous → case 3 fall-through).
- [ ] 4.6 Edit `prompts/sp-04a-onboarding-admin.md` step 6 so the offer maps to this state (keep the question; the flow now honors it).

## WU5 — Consent rejection terminal (#3) ✅ DONE (PR-B)

- [x] 5.1 TEST: `datos.consentimiento === false` → `rechazo_consentimiento` + founder alert + warm close (`onboardingHandler.recovery.test.ts`).
- [x] 5.2 TEST: routing short-circuit covers `rechazo_consentimiento` (`esEstadoOnboardingTerminal`, `onboardingOutcome.test.ts`).
- [x] 5.3 Implement `finalizarConsentRechazado` in both handlers (structured `consentimiento=false` drives it; copy unchanged). Prompt copy tweak deferred — behavior is structural.

## WU6 — STT degradation (#7) ✅ DONE (PR-B)

- [x] 6.1 TEST: failed/empty STT → ask-to-type, LLM NOT invoked, step NOT advanced (`onboardingHandler.recovery.test.ts`).
- [x] 6.2 Implement `obtenerTextoEntrada` + `manejarSttDegradado` in both flows.

## WU7 — Agricultor approval resilience (#5)

- [ ] 7.1 TEST: scan finds `pendiente_aprobacion` older than `APPROVAL_REMINDER_TIMEOUT` → re-notify jefe once, increment `aprobacion_recordatorios`, set `ultimo_recordatorio_at` (idempotent within interval).
- [ ] 7.2 TEST: `aprobacion_recordatorios >= APPROVAL_MAX_REMINDERS` still pending → founder escalation once, `agricultor_approval_timeout` event.
- [ ] 7.3 TEST: approval arrives before escalation → no further nudge/escalation; user `activo`.
- [ ] 7.4 TEST: within-timeout `pendiente_aprobacion` is NOT classified as stuck by `getOnboardingsTrabados`.
- [ ] 7.5 Implement `approvalReminderWorker.ts` (pg-boss; match existing worker scheduling) + register it.

## WU8 — Back-office query (data only, no UI) ✅ DONE (PR-A)

- [x] 8.1 TEST: `getOnboardingsTrabados()` returns the two terminal states + pending approvals with derived `motivo` (`tests/pipeline/onboardingEstado.test.ts`, 3 tests).
- [x] 8.2 Implement in `supabaseQueries.ts` via PostgREST `.or(...)`. Transport-agnostic. (No endpoint, no UI — consumed later by founder-backoffice.)

## WU9 — Verification

- [ ] 9.1 Full test suite green.
- [ ] 9.2 `sdd-verify` against specs (recovery, terminal-paths, agricultor-approval, founder-alerts).
- [ ] 9.3 Update CLAUDE.md CAPA 3: note onboarding terminal states + founder alert under D16 (and cross-ref the breadcrumbs feeding future founder-backoffice metrics).

---

## Review Workload Forecast

- Estimated changed lines: **> 400** (migration + queries + 2 handler flows + routing + worker + helper + prompts + tests).
- Touches `**/auth/**`-adjacent routing and a new worker → **4R review recommended** at PR.
- **Chained PRs recommended: Yes.** Natural cut points:
  - **PR-A (foundation):** WU1 + WU2 + WU8 (schema, state primitive, alert helper, query) — no behavior change to live flows yet.
  - **PR-B (recovery):** WU3 + WU5 + WU6 (the silent-abandonment fixes).
  - **PR-C (activation B):** WU4 (the trickiest, isolated for focused review).
  - **PR-D (approval worker):** WU7 + WU9.
- **Decision needed before apply: Yes** — confirm chained vs single `size:exception`, and chain strategy.
