# Founder Onboarding Alerts Specification

## Purpose

Defines the founder's first visibility surface into onboarding: a proactive WhatsApp alert when an onboarding gets stuck or rejected, reusing the existing `FOUNDER_PHONE` mechanism (already used in `procesarMensajeEntrante` and `handleFounderApproval`). This is Slice 1 of audit finding #4; the rich `/admin` onboarding view is explicitly delegated to the `founder-backoffice` epic.

## Requirements

### Requirement: Founder Is Alerted on a Stuck or Rejected Onboarding

The system MUST send a WhatsApp message to `FOUNDER_PHONE` when an onboarding reaches a terminal trouble state: `requires_review` (step ceiling or attempt-limit), consent rejection, or exhausted agricultor-approval escalation.

The alert MUST identify the affected user/finca and the reason, enough for the founder to act without opening a dashboard.

#### Scenario: Onboarding enters requires_review

- GIVEN an onboarding that transitions to `requires_review`
- WHEN the transition is committed
- THEN a WhatsApp alert is sent to `FOUNDER_PHONE` naming the user (phone/name), the finca/org if known, and the reason (e.g. step ceiling)

#### Scenario: Consent rejected

- GIVEN a user who rejects consent
- WHEN the consent-rejected terminal is committed
- THEN a WhatsApp alert is sent to `FOUNDER_PHONE` indicating a closed contact declined consent

#### Scenario: FOUNDER_PHONE not configured

- GIVEN `FOUNDER_PHONE` is unset
- WHEN an alert would be emitted
- THEN the system records the alert intent in observability (P4) and does not throw
- AND the onboarding terminal transition still succeeds (alerting is best-effort, never blocks the flow)

---

### Requirement: Alerts Are Idempotent (No Spam)

A given stuck/rejected onboarding MUST trigger at most one founder alert per terminal transition. Repeated inbound messages from an already-stuck user MUST NOT re-emit the alert.

#### Scenario: Stuck user keeps messaging

- GIVEN a user already in `requires_review` for whom a founder alert was sent
- WHEN the user sends further messages
- THEN no additional founder alert is emitted for the same terminal state
- AND the idempotency guard survives worker retries (same monotonic pattern as the existing consent guard)

---

### Requirement: Durable Onboarding Breadcrumbs Are Captured for Later Metrics

Because `sesiones_activas` is ephemeral (30-min TTL, GC'd), step-level and timing data is lost once a session ends. To make a future onboarding funnel (completion rate, drop-off by step, time-to-complete) computable, this change MUST durably capture the breadcrumbs on the `usuarios` row at the moments it already writes state — even though aggregation and the `/admin` UI are out of scope here.

The system MUST stamp: when onboarding started, when it completed, and the step at which it became `requiere_revision`. Capturing is best-effort and MUST NOT block the flow (P4).

#### Scenario: Onboarding starts

- GIVEN a user's first onboarding turn (`onboarding_estado` transitions from `no_iniciado`/null to `en_progreso`)
- WHEN the transition is committed
- THEN `onboarding_iniciado_at` is stamped if not already set

#### Scenario: Onboarding completes

- GIVEN a user completing onboarding
- WHEN `onboarding_estado` is set to `completo`
- THEN `onboarding_completado_at` is stamped

#### Scenario: Onboarding gets stuck at a step

- GIVEN a user transitioning to `requiere_revision`
- WHEN the transition is committed
- THEN the step reached (`paso_trabado`) is recorded on the user, so future drop-off analysis is possible without the (already GC'd) session

---

### Requirement: Stuck-Onboarding Data Is Queryable for the Back-Office

The system MUST expose the set of stuck/pending onboardings (e.g. `requires_review`, consent-rejected, long-pending approval) through a consumer-agnostic query, so the `founder-backoffice` `/admin` view can later render it without rewriting logic (same principle as `provisionarCliente`). This change is NOT required to build the `/admin` UI.

#### Scenario: Query returns stuck onboardings

- GIVEN users in terminal-trouble or long-pending onboarding states
- WHEN the query helper is called
- THEN it returns those users with reason and timestamps
- AND the helper is free of HTTP/transport concerns so any consumer (alert worker, future `/api/admin` endpoint) can use it
