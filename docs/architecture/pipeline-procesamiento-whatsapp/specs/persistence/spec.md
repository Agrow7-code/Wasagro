# Spec: persistence
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers all database write operations: inserting field events into `eventos_campo`, logging incoming messages in `mensajes_entrada`, idempotency enforcement, Row Level Security policy requirements, audio storage for the H-TEC-02 evaluation dataset, and the constraint that no DELETE operations are permitted in H0.

---

## Requirements

### REQ-persistence-001: Always persist descripcion_raw
**Priority**: MUST
**Rule**: P5 (farm data belongs to the farm — original input must be preserved)

Every `eventos_campo` INSERT MUST include `descripcion_raw` set to the user's original input text — the unprocessed raw content as received. For audio messages, `descripcion_raw` MUST be the post-corrected transcription text (not the raw transcription, which may contain STT errors). For image messages, `descripcion_raw` MUST be the caption text (if any) plus the vision analysis output. This field MUST never be null for any event, regardless of how the event was classified.

**Acceptance criteria**:
- [ ] An event INSERT with `descripcion_raw = null` is rejected at the application layer before reaching the DB
- [ ] Audio: `descripcion_raw` contains the post-corrected transcription, not the audio reference URL
- [ ] Image: `descripcion_raw` contains caption + vision description; if no caption exists, vision description alone
- [ ] Text: `descripcion_raw` contains the original message body as received from the webhook

---

### REQ-persistence-002: INSERT mensajes_entrada on every received message
**Priority**: MUST
**Rule**: Idempotency (R-02), observability trail

Every message that passes webhook validation MUST be inserted into `mensajes_entrada` with `status='received'` before any processing begins. This is the idempotency lock (the `wa_message_id` UNIQUE constraint prevents double processing). The record MUST be updated to `status='processing'` when `flujo-02` starts and to `status='processed'` when the event is persisted, or `status='error'` if the pipeline fails.

**Acceptance criteria**:
- [ ] A message that passes signature validation is inserted into `mensajes_entrada` before any LLM call
- [ ] `wa_message_id` (wamid) is stored as-is from the Meta payload
- [ ] Status lifecycle is: `received` → `processing` → `processed` or `error`; no status is skipped
- [ ] On `status='processed'`, `evento_id` is populated with the UUID of the created `eventos_campo` record

---

### REQ-persistence-003: RLS policy — users see only their farm's data
**Priority**: MUST
**Rule**: P5 (farm data isolation)

Row Level Security MUST be enabled on `eventos_campo`, `mensajes_entrada`, `sesiones_activas`, `lotes`, and `fincas`. The RLS policy for `eventos_campo` MUST restrict SELECT to rows where `finca_id` matches the authenticated user's `finca_id`. The system user (service role) used by n8n MUST bypass RLS for writes — but the API used for any user-facing queries MUST enforce RLS. No cross-farm data leakage is acceptable.

**Acceptance criteria**:
- [ ] A user authenticated as Finca F001 cannot SELECT events belonging to Finca F002 via the user-facing API
- [ ] The n8n service role can INSERT to any farm's events (required for the pipeline)
- [ ] RLS is enabled (not just defined) on all tables listed above
- [ ] RLS policies are tested by attempting a cross-farm query in the verify phase

---

### REQ-persistence-004: No DELETE operations in H0
**Priority**: MUST
**Rule**: R3 (no irreversible action without human approval), R5 (H0 scope)

No DELETE statements on production data are permitted in the H0 pipeline. All state transitions MUST use `status` field updates (soft-delete pattern). The only exception is the onboarding consent rejection case: if a user rejects consent and their first message contained provisional data, that provisional data MUST be deleted (this is the one legally-mandated DELETE, and it applies only to in-memory provisional data, not to a row that was already committed — see onboarding/spec.md REQ-onboarding-005). No `DROP TABLE`, `TRUNCATE`, or mass-DELETE is permitted in any H0 migration or flow.

**Acceptance criteria**:
- [ ] No n8n flow node executes a DELETE SQL statement against `eventos_campo`, `mensajes_entrada`, `usuarios`, `fincas`, or `lotes`
- [ ] Events that are invalid or require review are marked with `status='requires_review'` — never deleted
- [ ] Expired session records remain in `sesiones_activas` with their final status — never deleted
- [ ] The consent rejection DELETE (if applicable) targets only the provisional in-memory representation, and is explicitly noted in the onboarding spec

---

### REQ-persistence-005: Audio storage for H-TEC-02 evaluation
**Priority**: MUST

The FIRST 30 audio messages received (across all farms, across the entire H0 phase) MUST be stored in the Supabase Storage bucket `audio-eval/` in addition to normal processing. This dataset is the ground truth corpus for hypothesis H-TEC-02 (STT WER validation). The system MUST track the count of stored evaluation audios in a configuration variable or a dedicated counter to know when the 30-audio limit is reached. After 30 audios are stored, subsequent audios are processed normally without storage.

**Acceptance criteria**:
- [ ] The first audio message triggers a write to `audio-eval/{wamid}.opus` in Supabase Storage
- [ ] A counter (configuration variable or DB field) is incremented on each eval audio stored
- [ ] When the counter reaches 30, no further audios are written to `audio-eval/`
- [ ] The `mensajes_entrada` record for eval-stored audios includes the `media_ref` path to the storage location
- [ ] Audio files in `audio-eval/` are NOT accessible to end users (RLS or bucket policy restricts access to service role only)

---

### REQ-persistence-006: WhatsApp cost tracking
**Priority**: SHOULD

Every outbound WhatsApp message sent by the system MUST produce an INSERT into `wa_message_costs` with: `finca_id`, `direction='outbound'`, `message_type` (`text`, `template`), and `cost_usd`. User-initiated messages within the 24-hour conversation window have `cost_usd=0` for system replies. Template messages sent outside the 24-hour window use the applicable Meta rate for Ecuador/Guatemala. Inbound messages MUST also be logged with `direction='inbound'` and `cost_usd=0` (inbound is free).

**Acceptance criteria**:
- [ ] Every outbound message from `flujo-02` (acknowledgement, clarification, confirmation) creates a `wa_message_costs` record
- [ ] The weekly report template message creates a `wa_message_costs` record with the applicable template cost
- [ ] Inbound messages are logged with `cost_usd=0`
- [ ] The `wa_message_costs` table can be queried to compute total cost per farm per week

---

### REQ-persistence-007: Datos_evento JSONB structure per event type
**Priority**: MUST
**Rule**: R1 (only persist what was extracted)

The `datos_evento` JSONB column in `eventos_campo` MUST follow the canonical structure per `tipo_evento` as defined in the extraction spec (REQ-extraction-003). Fields that were not extracted MUST be stored as `null` within the JSONB — not omitted from the object. This ensures consistent schema for downstream reporting queries. The `confidence_score` map (per-field scores) MUST be stored alongside the event data, either as a separate column or as a reserved key `_confidence` within `datos_evento`.

**Acceptance criteria**:
- [ ] An `insumo` event always has keys `producto`, `dosis_cantidad`, `dosis_unidad`, `dosis_litros_equivalente`, `area_ha` — even if some are `null`
- [ ] The confidence scores per field are queryable (not discarded after extraction)
- [ ] An `observacion` event's `datos_evento` contains `texto_libre` and `clasificacion_ia` (null if no classification)

---

## Scenarios

### SC-persistence-001: Successful event persist
**Given** LLM extraction produces a complete `insumo` event with all critical fields and confidence >= 0.5 for each
**When** the persistence step runs
**Then** an INSERT into `eventos_campo` succeeds with: `tipo_evento='insumo'`, `descripcion_raw` set to original input, `datos_evento` structured per the canonical `insumo` schema, `status='active'`
**And** `mensajes_entrada` is updated with `status='processed'` and `evento_id` pointing to the new event
**And** the LangFuse span `persistir_evento` logs the event UUID and tipo_evento

---

### SC-persistence-002: Duplicate message rejected by idempotency
**Given** Meta retries a webhook with the same `wamid` that was already processed
**When** the idempotency check runs (SELECT or INSERT on `mensajes_entrada.wa_message_id`)
**Then** the duplicate is detected
**And** no second INSERT into `eventos_campo` is created
**And** the `mensajes_entrada` record retains its original `status='processed'` (not overwritten)
**And** the user receives no second acknowledgement or confirmation

---

### SC-persistence-003: Audio stored for evaluation (first 30)
**Given** an audio message arrives and the evaluation counter is at 12 (fewer than 30)
**When** the audio is downloaded from Meta's Graph API
**Then** the binary `.opus` file is stored in Supabase Storage at `audio-eval/{wamid}.opus`
**And** the evaluation counter is incremented to 13
**And** the `mensajes_entrada` record has `media_ref` set to the storage path
**And** normal STT processing continues on the downloaded file

---

### SC-persistence-004: Audio NOT stored after 30th
**Given** an audio message arrives and the evaluation counter is already at 30
**When** the audio download completes
**Then** the file is NOT stored in `audio-eval/`
**And** STT processing continues normally
**And** the `mensajes_entrada.media_ref` is null or points to a temporary buffer (not the storage bucket)

---

### SC-persistence-005: Consent revocation — data NOT deleted, marked for review
**Given** a user who previously gave consent and has 5 `eventos_campo` records now contacts support requesting data removal
**When** an authorized operator processes the request (human-initiated, not automated)
**Then** the user's `consentimiento_datos` is set to `false` in `usuarios`
**And** existing `eventos_campo` records are NOT deleted
**And** existing records are updated with `status='requires_review'` to flag them for human review
**And** new incoming messages from this user trigger a consent request flow (REQ-webhook-005, case 3)
**And** no automated DELETE is executed (R3 — irreversible action requires human approval)
