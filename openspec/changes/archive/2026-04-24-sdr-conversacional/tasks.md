# Tasks: sdr-conversacional
> Change: sdr-conversacional | Phase: sdd-tasks | Date: 2026-04-24

---

## Phase 1 — GroqLLM SDR implementation (missing provider)

**[x] 1.1 RED** — Add failing test for `GroqLLM.atenderSDR()` in `tests/integrations/llm/GeminiLLM.test.ts` (or new `GroqSDR.test.ts`): assert it loads `SP-SDR-01-master.md`, calls LLM, parses `RespuestaSDRSchema`, and emits LangFuse generation.

**[x] 1.2 GREEN** — Implement `atenderSDR(entrada, traceId)` in `src/integrations/llm/GroqLLM.ts` following the same pattern as `GeminiLLM.atenderSDR`: `cargarSDRPrompt` + `buildSDRContexto` + `#llamar` + `RespuestaSDRSchema.safeParse`. *(Already implemented at lines 266-305 — verified)*

---

## Phase 2 — Score evidence validation gate (REQ-qual-009)

**[x] 2.1 RED** — Add test in `tests/agents/sdrAgent.test.ts`: when LLM returns non-zero `score_delta` with null `evidence_quote`, assert `saveSDRInteraccion` is NOT called and an error is logged.

**[x] 2.2 GREEN** — In `src/agents/sdrAgent.ts`, before DB writes, validate each non-zero delta has `evidence_quote`. If invalid: log LangFuse error event, skip score update, continue with zero delta.

---

## Phase 3 — Handoff trigger: human request + price readiness (REQ-hand-001)

**[x] 3.1 RED** — Add tests in `tests/agents/sdrAgent.test.ts`: (a) message containing "quiero hablar con alguien" triggers `propose_pilot` regardless of score; (b) message with "¿cuánto cuesta?" after turn 3 triggers handoff.

**[x] 3.2 GREEN** — In `src/agents/sdrAgent.ts`, add `detectarHandoffTrigger(texto, turno): 'score_threshold' | 'human_request' | 'price_readiness' | null`. Call before LLM when score < 65. If non-null, force `action = 'propose_pilot'` and set `handoff_trigger` in deal brief.

---

## Phase 4 — Full founder notification format (REQ-hand-003)

**[x] 4.1 RED** — Add test in `tests/agents/sdrAgent.test.ts`: `buildFounderNotification` output matches spec template (Score/100, segmento, narrativa, emoji fields, "Responde *SÍ*…").

**[x] 4.2 GREEN** — Rewrite `buildFounderNotification` in `src/agents/sdrAgent.ts` to match the full spec format from REQ-hand-003, including all deal brief fields and the three-option footer.

---

## Phase 5 — Segment detection and mid-conversation update (REQ-disc-003)

**[x] 5.1 RED** — Add test in `tests/agents/sdrAgent.test.ts`: when LLM response includes `segmento_icp` field, `updateSDRProspecto` is called with the new segment value.

**[x] 5.2 GREEN** — In `src/agents/sdrAgent.ts`, read `resultado.segmento_icp` from `RespuestaSDR` if present. Add `segmento_icp?: string` to `RespuestaSDRSchema` in `src/types/dominio/SDRTypes.ts`. Persist update in the same `updateSDRProspecto` call.

---

## Phase 6 — LangFuse A/B narrative events (REQ-narr-005)

**[x] 6.1 RED** — Add tests in `tests/agents/sdrAgent.test.ts`: (a) `sdr_session_started` fires on new prospect with `{narrativa, segmento_icp}`; (b) `sdr_qualified` fires when score crosses 65 with `{narrativa, score_total, turns_to_qualify}`; (c) `sdr_unqualified` fires on graceful_exit.

**[x] 6.2 GREEN** — In `src/agents/sdrAgent.ts`, add the missing trace events: `sdr_session_started` on new prospect creation; `sdr_qualified` when `action === 'propose_pilot'`; `sdr_unqualified` when `action === 'graceful_exit'`.

---

## Phase 7 — Post-approval DEMO_BOOKING_URL flow (REQ-hand-006)

**[x] 7.1 RED** — Add tests in `tests/agents/sdrAgent.test.ts`: (a) founder SÍ + `DEMO_BOOKING_URL` set → pilot message includes the URL; (b) founder SÍ + no URL → message asks for availability.

**[x] 7.2 GREEN** — In `src/agents/sdrAgent.ts` `handleFounderApproval`: after sending pilot proposal, check `DEMO_BOOKING_URL`. If set, append booking link to outbound message. Update `reunion_agendada_at` when prospect confirms a time (requires new interaction handler).

---

## Phase 8 — SDR Supabase query tests (REQ-mem coverage)

**[x] 8.1 RED** — Add SDR-specific tests in `tests/pipeline/supabaseQueries.test.ts`: (a) `createSDRProspecto` inserts with correct defaults (score_champion=7, score_presupuesto=5); (b) `getSDRProspecto` returns null for unknown phone; (c) `getSDRProspectosPendingApproval` filters by status='qualified' and founder_notified_at IS NOT NULL.

**[x] 8.2 GREEN** — Verify and fix `src/pipeline/supabaseQueries.ts` SDR query implementations if any test from 8.1 fails. No new code expected — this phase validates existing queries against spec defaults.
