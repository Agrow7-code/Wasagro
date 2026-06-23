# Onboarding Recovery Specification

## Purpose

Defines how the WhatsApp onboarding flow handles non-completion so a user can never be trapped in an infinite restart loop. Replaces the current behavior where reaching the step ceiling marks the session `completed` while `usuario.onboarding_completo` stays `false`, causing `procesarMensajeEntrante` to re-route to onboarding forever (with a fresh empty session each time, restarting from step 1).

Addresses audit findings #1 (10-step dead-end) and #6 (P2 has no structural backstop). New domain — no existing spec.

## Requirements

### Requirement: Durable Terminal Onboarding State on the User

The routing gate in `procesarMensajeEntrante` is the durable field `usuario.onboarding_completo`, not the ephemeral session (30-min TTL, GC'd). Therefore a non-completing onboarding MUST be recorded as a durable terminal state on the `usuarios` row, not only on `sesiones_activas`.

The system MUST introduce a durable onboarding state on `usuarios` that can express, at minimum: in-progress, completed, and requires-review. `onboarding_completo` (boolean) MUST remain backward-compatible; the new state is orthogonal and authoritative for routing decisions about stuck onboardings.

#### Scenario: Onboarding reaches the step ceiling

- GIVEN a user in onboarding whose next step would exceed `MAX_ONBOARDING_STEPS`
- WHEN the handler processes that turn
- THEN the user's durable onboarding state is set to `requires_review`
- AND the session is NOT left in a state that `getOrCreateSession` would resume into a fresh empty onboarding
- AND the user receives a single clear holding message (not a re-asked step-1 greeting)
- AND a founder alert is emitted exactly once (see founder-alerts spec)

#### Scenario: Stuck user sends another message

- GIVEN a user whose durable onboarding state is `requires_review`
- WHEN a new inbound message arrives
- THEN `procesarMensajeEntrante` MUST NOT route to `handleOnboardingAdmin`/`handleOnboardingAgricultor` (no restart from step 1)
- AND MUST NOT route to `handleEvento` (the user never completed onboarding)
- AND the user receives at most one holding/acknowledgement message, with no duplicate founder alert

#### Scenario: Successful completion is distinct from stuck

- GIVEN a user who completes onboarding normally
- WHEN the handler finalizes the flow
- THEN the durable onboarding state is `completed` AND `onboarding_completo = true`
- AND this is unambiguously distinguishable from a `requires_review` terminal (the root ambiguity of finding #1, where both ended as session `completed`)

---

### Requirement: Structural Backstop for the Clarification Limit (P2)

The "max 2 attempts per step" rule (P2) MUST have a structural backstop in code, not only in the prompt. The system MUST NOT depend solely on the LLM correctly incrementing `siguiente_paso` to bound the conversation.

When a step does not advance after the configured number of attempts, the system MUST transition the user to `requires_review` rather than continuing to re-ask indefinitely or relying on the step ceiling alone.

#### Scenario: Same step retried beyond the limit

- GIVEN a user stuck on the same onboarding step across repeated turns without producing the required field
- WHEN the per-step attempt count exceeds the configured limit
- THEN the system transitions the user to `requires_review`
- AND emits an observability event recording the step and attempt count (P4)
- AND does not loop on that step again

#### Scenario: LLM fails to increment the step

- GIVEN an LLM response that does not advance `siguiente_paso` and does not mark `onboarding_completo`
- WHEN this repeats beyond the configured attempt limit
- THEN the structural backstop (not the prompt) forces the `requires_review` transition
