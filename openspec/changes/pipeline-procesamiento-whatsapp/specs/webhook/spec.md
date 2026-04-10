# Spec: webhook
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers reception of WhatsApp messages via Meta Cloud API webhook, signature validation, message parsing, idempotency enforcement, user-state-based routing, and immediate acknowledgement delivery. This domain is the entry gate — everything downstream depends on it behaving correctly.

---

## Requirements

### REQ-webhook-001: Immediate HTTP 200 response
**Priority**: MUST
**Rule**: Mitigates R-02 (Meta retry on timeout); supports P3 (latency <30s)

The webhook endpoint MUST respond HTTP 200 to Meta's POST request before performing any processing — including user lookup, signature validation result logging, or flow execution. The 200 response MUST be sent within 3 seconds of receiving the request. Meta retries webhooks that do not receive HTTP 200 within 20 seconds; an asynchronous processing architecture is REQUIRED to satisfy this constraint.

**Acceptance criteria**:
- [ ] HTTP 200 is returned before any downstream n8n node executes business logic
- [ ] The response body MAY be empty or contain `{"status":"ok"}`; it MUST NOT block on DB queries or LLM calls

---

### REQ-webhook-002: Signature validation
**Priority**: MUST

Every incoming POST MUST have its `x-hub-signature-256` header verified against the configured WhatsApp App Secret using HMAC-SHA256. Payloads that fail signature validation MUST be silently discarded — no processing, no user notification. The failure MUST be logged (see REQ-observability-001).

**Acceptance criteria**:
- [ ] A valid signature produces no rejection and processing continues normally
- [ ] An invalid or missing `x-hub-signature-256` header causes the message to be discarded without processing
- [ ] Signature validation failures are logged with the source IP and timestamp (no sensitive payload content)

---

### REQ-webhook-003: Parse all three message types
**Priority**: MUST

The webhook parser MUST extract the relevant fields from Meta Cloud API payloads for all three supported message types: `text`, `audio`, and `image`. For each type the system MUST extract: `wamid` (message ID), `from` (sender phone, E.164 without `+`), `timestamp`, `type`, and type-specific content (`text.body`, `audio.id` + `audio.mime_type`, `image.id` + `image.mime_type` + `image.caption`). Any other `type` value (e.g. `sticker`, `document`, `video`) MUST be handled gracefully — logged and discarded with no error to the user.

**Acceptance criteria**:
- [ ] `text` messages: `text.body` is extracted and available to downstream routing
- [ ] `audio` messages: `audio.id` (media_id) and `mime_type` are extracted; `voice: true` is noted for context
- [ ] `image` messages: `image.id`, `mime_type`, and `caption` (nullable) are extracted
- [ ] Unsupported `type` values result in a log entry and no further processing; the webhook still returns HTTP 200

---

### REQ-webhook-004: Idempotency via wamid
**Priority**: MUST
**Rule**: R-02 (Meta retries on timeout can produce duplicate deliveries)

Every received message MUST be checked against `mensajes_entrada.wa_message_id` (UNIQUE constraint) before processing. If a record with the same `wamid` already exists, the message MUST be discarded without re-processing. The idempotency check MUST happen before any LLM call or state mutation. The initial INSERT into `mensajes_entrada` with `status='received'` serves as the idempotency lock.

**Acceptance criteria**:
- [ ] First occurrence of a `wamid`: INSERT succeeds, processing continues
- [ ] Second occurrence of the same `wamid` (retry from Meta): INSERT fails on UNIQUE constraint or SELECT detects existing record; processing is aborted; no duplicate event is created
- [ ] Duplicate detection does not send a second acknowledgement to the user

---

### REQ-webhook-005: User-state routing
**Priority**: MUST

After idempotency check, the system MUST determine the user's state by querying `usuarios` by `phone`. Routing MUST follow this decision tree in order:
1. User not found → trigger `flujo-03-onboarding` (first contact)
2. User found, `onboarding_completo = false` → trigger `flujo-03-onboarding` (resume)
3. User found, `consentimiento_datos = false` → send consent request message; do not process data
4. User found, onboarding complete, consent given → route to `flujo-02-procesar-reporte`

A `text` message that matches heuristic patterns for greetings or queries (e.g. starts with "hola", "gracias", contains "?") SHOULD be answered with a direct response without entering `flujo-02`. All `audio` and `image` messages MUST always route to `flujo-02`.

**Acceptance criteria**:
- [ ] An unknown phone number always triggers onboarding, never event extraction
- [ ] A user with `onboarding_completo=false` cannot submit reports regardless of message content
- [ ] A user with `consentimiento_datos=false` receives a consent request message; their data is NOT stored in `eventos_campo`
- [ ] Greetings from fully-onboarded users receive a direct reply without LLM extraction pipeline being invoked

---

### REQ-webhook-006: Pre-pipeline acknowledgement
**Priority**: MUST
**Rule**: P3 (ack <5s)

For every message that enters `flujo-02-procesar-reporte` (i.e. goes to LLM extraction), the system MUST send a WhatsApp acknowledgement message — "Estoy procesando tu reporte..." — via Meta Cloud API before the LLM pipeline begins. This acknowledgement MUST be sent within 5 seconds of webhook receipt. Audio and image messages MUST always receive this acknowledgement. Text messages routed to extraction MUST also receive it.

**Acceptance criteria**:
- [ ] Audio message triggers acknowledgement before STT download begins
- [ ] Image message triggers acknowledgement before media download begins
- [ ] Text message classified as a report triggers acknowledgement before LLM extraction call
- [ ] Greetings and simple queries do NOT receive the "Estoy procesando..." acknowledgement (they get a direct response instead)
- [ ] Acknowledgement is sent in under 5 seconds from webhook receipt in the normal case

---

## Scenarios

### SC-webhook-001: Happy path — text message from active user
**Given** a POST arrives at the webhook endpoint with a valid `x-hub-signature-256`, containing a `text` message with body "Aplique 5 bombadas de Mancozeb en el lote 3", from a phone number with `onboarding_completo=true` and `consentimiento_datos=true`, and no prior record of this `wamid` in `mensajes_entrada`
**When** the webhook processes the payload
**Then** HTTP 200 is returned immediately
**And** the `x-hub-signature-256` header is validated successfully
**And** an INSERT into `mensajes_entrada` with `status='received'` is created
**And** the user is looked up and confirmed as active
**And** the text is classified as a report (not a greeting)
**And** the acknowledgement "Estoy procesando tu reporte..." is sent to the user
**And** `flujo-02-procesar-reporte` is triggered with the message payload

---

### SC-webhook-002: Happy path — audio message
**Given** a POST arrives with a valid signature containing an `audio` message (mime_type `audio/ogg; codecs=opus`) from an active, fully-onboarded user
**When** the webhook processes the payload
**Then** HTTP 200 is returned immediately
**And** the `audio.id` (media_id) is extracted
**And** the message is inserted into `mensajes_entrada` with `tipo_mensaje='audio'`
**And** the acknowledgement is sent before any media download starts
**And** `flujo-02-procesar-reporte` is triggered with the media_id

---

### SC-webhook-003: Duplicate message (Meta retry)
**Given** a POST arrives with a `wamid` that already exists in `mensajes_entrada`
**When** the idempotency check runs
**Then** the duplicate is detected (SELECT returns existing row OR INSERT fails on UNIQUE constraint)
**And** no new entry is created in `mensajes_entrada`
**And** `flujo-02-procesar-reporte` is NOT triggered
**And** no acknowledgement is sent to the user a second time
**And** the discard is logged silently

---

### SC-webhook-004: Invalid signature
**Given** a POST arrives with an `x-hub-signature-256` header that does not match the HMAC-SHA256 of the payload body
**When** signature validation runs
**Then** the payload is discarded without any DB write or user notification
**And** the event is logged with source IP, timestamp, and failure reason (no payload content)
**And** the webhook still returns HTTP 200 (to avoid Meta inferring endpoint behavior)

---

### SC-webhook-005: Unknown user triggers onboarding
**Given** a POST arrives with a valid signature from a phone number not present in `usuarios`
**When** the user state check runs
**Then** `flujo-03-onboarding` is triggered for this phone number
**And** `flujo-02-procesar-reporte` is NOT triggered
**And** no event extraction or LLM pipeline is invoked

---

### SC-webhook-006: User without consent
**Given** a POST arrives from a user who exists in `usuarios` with `consentimiento_datos=false`
**When** the routing logic evaluates user state
**Then** the system sends a consent-request message to the user explaining data capture requires consent
**And** the message content is NOT stored in `eventos_campo` or processed by the LLM extraction pipeline
**And** `flujo-02-procesar-reporte` is NOT triggered

---

### SC-webhook-007: Unsupported message type (sticker)
**Given** a POST arrives containing a message with `type='sticker'`
**When** the type parser evaluates the message
**Then** the message is logged as unsupported type
**And** no extraction or onboarding flow is triggered
**And** no response is sent to the user
**And** HTTP 200 was already returned as required
