# Agricultor Approval Resilience Specification

## Purpose

Defines resilience for the agricultor approval handoff. Today an agricultor who finishes onboarding enters `status = 'pendiente_aprobacion'` and the jefe receives a single WhatsApp prompt ("responde *aprobar X*"). The mechanism exists (`handleAprobacion`, `getPendientesAprobacion`) but has no recovery: if the jefe never approves, the agricultor waits forever with no re-nudge, no timeout, and no escalation. Addresses audit finding #5.

## Requirements

### Requirement: Pending Approval Has a Bounded Wait with Re-Nudge

A `pendiente_aprobacion` agricultor MUST NOT be left waiting indefinitely on a single un-actioned jefe notification. After a configurable timeout, the system MUST re-nudge the jefe (or propietario) of that finca.

The re-nudge MUST be idempotent and bounded — it MUST NOT spam the jefe on every cycle, and MUST stop after a configured number of attempts.

#### Scenario: Jefe does not act within the timeout

- GIVEN an agricultor in `status = 'pendiente_aprobacion'` whose jefe was notified
- WHEN the configured timeout elapses without an approval
- THEN the jefe (or propietario) of that finca is re-notified once
- AND the re-notification is recorded so it is not repeated before the next interval (idempotent)

#### Scenario: Pending approval is normal waiting, not stuck onboarding

- GIVEN an agricultor in `pendiente_aprobacion` within the timeout window
- WHEN the founder-visibility logic evaluates stuck onboardings
- THEN this agricultor is NOT classified as "stuck/requires_review" (legitimate waiting), distinct from abandonment

---

### Requirement: Unresolved Approval Escalates to the Founder

When the re-nudge attempts are exhausted without an approval, the system MUST escalate to the founder so a closed client is not silently lost in the approval gap.

#### Scenario: Approval never happens after re-nudges

- GIVEN an agricultor in `pendiente_aprobacion` whose jefe has been re-nudged the maximum number of times
- WHEN the final timeout elapses without approval
- THEN a founder alert is emitted exactly once (see founder-alerts spec)
- AND the escalation is recorded in observability (P4)

#### Scenario: Approval arrives before escalation

- GIVEN an agricultor in `pendiente_aprobacion`
- WHEN the jefe sends "aprobar <nombre>" before the escalation threshold
- THEN `handleAprobacion` activates the agricultor as today
- AND no further re-nudge or escalation is emitted for that agricultor
