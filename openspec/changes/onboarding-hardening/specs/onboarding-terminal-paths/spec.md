# Onboarding Terminal & Edge Paths Specification

## Purpose

Defines correct handling of three conversational paths where the current onboarding misleads the user or degrades silently: the activation step's dangling promise (#2), consent rejection as a mute dead-end (#3), and speech-to-text failure during onboarding (#7). New domain — no existing spec.

## Requirements

### Requirement: Activation Honors the Explanation Offer via a One-Turn Post-Onboarding State

The activation step MUST NOT, in the same turn, both offer a follow-up interaction (e.g. "¿quieres que te explique cómo funciona?") and mark `onboarding_completo = true`. Once `onboarding_completo` is true, the next inbound message routes to `handleEvento` (field-event extraction), so the offered explanation could never be delivered — the same dangling-promise anti-pattern already seen in the Sigatoka follow-up.

The system MUST honor the offer by modeling a transient post-onboarding state (`onboarding_estado = 'esperando_explicacion'`, `onboarding_completo` still `false`) that retains conversational control for exactly one more turn. This state MUST be self-healing: ANY next inbound message finalizes onboarding (no indefinite `onboarding_completo = false`), so it can never become a trap like finding #1.

#### Scenario: Activation offers the explanation and waits

- GIVEN a user who confirms the final onboarding step
- WHEN the handler finalizes data collection
- THEN `onboarding_estado` is set to `esperando_explicacion` and `onboarding_completo` remains `false`
- AND the closing message offers the "how it works" explanation
- AND routing for the next message goes to the onboarding flow (not `handleEvento`)

#### Scenario: User accepts the explanation

- GIVEN a user in `esperando_explicacion`
- WHEN the user affirms (e.g. "sí, explicame")
- THEN the agent sends the explanation
- AND onboarding is finalized (`onboarding_completo = true`, `onboarding_estado = 'completo'`)

#### Scenario: User declines or ignores the offer

- GIVEN a user in `esperando_explicacion`
- WHEN the user declines (e.g. "no, gracias")
- THEN the agent sends a brief warm close
- AND onboarding is finalized (`onboarding_completo = true`, `onboarding_estado = 'completo'`)

#### Scenario: User sends a real field report instead

- GIVEN a user in `esperando_explicacion`
- WHEN the next message is a field report rather than a yes/no (e.g. "fumigué el lote 3")
- THEN onboarding is finalized first (`onboarding_completo = true`, `onboarding_estado = 'completo'`)
- AND that same message is then dispatched to `handleEvento` so it is not swallowed
- AND the message is processed exactly once (no duplication)

---

### Requirement: Consent Rejection Is an Explicit, Notified Terminal State

Rejecting the data consent (P6) MUST be an explicit terminal state, not a mute dead-end that leaves `onboarding_completo = false` and re-asks consent on the next message. Because a rejected consent on a closed B2B deal is a situation requiring human follow-up, the founder MUST be notified.

#### Scenario: User rejects consent

- GIVEN a user at the consent step
- WHEN the user declines consent
- THEN the user's durable onboarding state is set to a consent-rejected terminal (not left re-askable in a loop)
- AND the user receives a clear, warm closing message
- AND a founder alert is emitted exactly once (see founder-alerts spec)
- AND no field data is captured or retained beyond what P6 permits for un-consented input

#### Scenario: Consent-rejected user sends another message

- GIVEN a user whose onboarding state is consent-rejected
- WHEN a new inbound message arrives
- THEN the system MUST NOT re-loop the consent step automatically
- AND MUST NOT route to `handleEvento`

---

### Requirement: Speech-to-Text Failure During Onboarding Degrades Explicitly

When transcription fails during onboarding, the system MUST NOT pass an empty `texto` to the LLM (causing a blind re-ask). It MUST tell the user the audio was not understood and ask them to type it.

#### Scenario: STT fails on an onboarding audio

- GIVEN an inbound audio message during onboarding
- WHEN transcription throws or returns empty
- THEN the user receives an explicit message asking them to type the answer (e.g. "No te entendí el audio, ¿lo escribís?")
- AND the LLM is NOT invoked with an empty user message for that turn
- AND the failure is recorded in observability (P4) without advancing the step
