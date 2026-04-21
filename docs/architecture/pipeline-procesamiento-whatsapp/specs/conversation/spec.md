# Spec: conversation
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers conversational session state management, the clarification loop (max 2 questions per turn), fallback to `nota_libre`, session TTL and expiration handling, and partial context merging across turns. Onboarding sessions are a separate session type covered in onboarding/spec.md.

---

## Requirements

### REQ-conversation-001: Session state in sesiones_activas
**Priority**: MUST
**Rule**: R2 (max 2 clarifications — requires persistent counter)

All conversational session state MUST be stored in the `sesiones_activas` table in Supabase. Session state MUST NOT be stored in n8n workflow variables, memory, or any component that does not survive process restarts. The `sesiones_activas` record for a report session MUST contain at minimum: `session_id`, `phone`, `finca_id`, `tipo_sesion='reporte'`, `clarification_count` (integer, default 0), `contexto_parcial` (JSONB, holds partial extraction from previous turn), `ultimo_mensaje_at`, `expires_at`, and `status`.

**Acceptance criteria**:
- [ ] A session record is created in `sesiones_activas` at the start of the first clarification turn
- [ ] `clarification_count` is incremented by 1 each time the system sends a clarification question
- [ ] The session persists if n8n restarts between turns (data lives in Supabase, not n8n memory)
- [ ] `contexto_parcial` contains the partial extraction JSON from the previous turn so the next turn can merge it

---

### REQ-conversation-002: Maximum 2 clarification questions per turn
**Priority**: MUST
**Rule**: R2 (explicit hard limit)

Within a single conversation turn (starting from a user message that triggered extraction), the system MUST NOT ask more than 2 clarification questions. Each clarification question counts as 1 toward the limit. At the moment `clarification_count` reaches 2 without the event being completable, the system MUST execute the fallback to `nota_libre` (see REQ-conversation-003). The 2-question limit applies per report-initiation event — it resets when a new report message arrives.

**Acceptance criteria**:
- [ ] First incomplete extraction: `clarification_count = 1`, one question sent
- [ ] User responds but event is still incomplete: `clarification_count = 2`, second question sent
- [ ] If after the second question the event is still incomplete: fallback to `nota_libre` is triggered immediately; no third question is ever sent
- [ ] A new report message from the same user resets the count (new session or session marked complete)

---

### REQ-conversation-003: Fallback to nota_libre after limit
**Priority**: MUST
**Rule**: R2, R1 (no fabrication to avoid fallback)

When `clarification_count >= 2` and the event remains incomplete, the system MUST persist the available data as `tipo_evento='nota_libre'` with `status='requires_review'`. The `descripcion_raw` MUST contain the original input text. The `contexto_parcial` MUST be stored in `datos_evento.extraccion_parcial` so a human reviewer can see what was extracted. The system MUST send the user: "Lo registro como nota y lo revisamos después." The session MUST be closed (status set to `completed` or `fallback_nota_libre`).

**Acceptance criteria**:
- [ ] Fallback creates an `eventos_campo` record with `tipo_evento='nota_libre'` and `status='requires_review'`
- [ ] The `descripcion_raw` field contains the original user input, not the partial extraction
- [ ] The partial extraction context is stored in `datos_evento` for human review
- [ ] The user confirmation message is exactly 1 short line; does not mention "base de datos", "JSON", or other prohibited vocabulary
- [ ] The session record in `sesiones_activas` is closed after fallback

---

### REQ-conversation-004: Session TTL and expiration
**Priority**: MUST

Every `sesiones_activas` record MUST have an `expires_at` timestamp set to `NOW() + INTERVAL '30 minutes'` at creation and MUST be refreshed to `NOW() + INTERVAL '30 minutes'` on every user message within the session. When a new message arrives and the session lookup finds a record with `expires_at <= NOW()`, the system MUST treat it as a new message (no context from the expired session). The expired session record MUST be ignored, and the new message starts fresh without merging stale context.

**Acceptance criteria**:
- [ ] A session created 31+ minutes ago (with no activity) is treated as expired; the next message starts fresh
- [ ] A session where the user replies within 30 minutes has its `expires_at` extended correctly
- [ ] An expired session is not deleted — it is left with its status for audit; only its `expires_at < NOW()` makes it inactive
- [ ] Filtering queries use `status='active' AND expires_at > NOW()` to find valid sessions

---

### REQ-conversation-005: Context merging on continuation turn
**Priority**: MUST
**Rule**: R1 (don't re-invent previously extracted data)

When a user message arrives and an active session with `contexto_parcial` is found, the system MUST merge the partial extraction from `contexto_parcial` with the new user input before running LLM extraction again. The merge strategy is: use the new message to supply missing or low-confidence fields from the previous turn; preserve high-confidence fields from the prior extraction. The merged text SHOULD be constructed as a combined input to the extraction LLM, not as separate calls.

**Acceptance criteria**:
- [ ] A user who said "apliqué urea" and then answers "en el lote de arriba" to the clarification produces a final extraction with both `subtipo='urea'` and `lote_id` correctly set
- [ ] Fields extracted with `confidence_score >= 0.5` in turn 1 are NOT re-asked in turn 2 even if not mentioned again
- [ ] The extraction prompt for turn 2 includes the partial extraction context from turn 1

---

### REQ-conversation-006: Single clarification question per turn
**Priority**: MUST
**Rule**: R2 (user experience — one question at a time)

Each clarification request MUST ask for exactly ONE missing field, not multiple fields simultaneously. The priority for which field to ask first is: `lote_id` first (most frequently missing), then the most critical type-specific field (product name for `insumo`, plague type for `plaga`, quantity for `cosecha`). If multiple fields are missing, only the highest-priority one is asked per turn. The second question (if needed in turn 2) asks for the next priority field.

**Acceptance criteria**:
- [ ] When `lote_id` and `subtipo` are both missing, turn 1 asks only for `lote_id`
- [ ] If after turn 1 `lote_id` is provided but `subtipo` is still missing, turn 2 asks only for `subtipo`
- [ ] No clarification message asks for more than one piece of information
- [ ] The clarification question is phrased naturally in Rioplatense/Ecuador-Guatemala Spanish, max 2 lines

---

### REQ-conversation-007: Report and onboarding sessions are distinct types
**Priority**: MUST

The `tipo_sesion` field in `sesiones_activas` MUST distinguish between `'reporte'` and `'onboarding'` sessions. An active onboarding session for a user MUST NOT interfere with a report session lookup, and vice versa. The conversation flow routing (flujo-01) MUST check the user's `onboarding_completo` status independently of active session type before routing to flujo-02.

**Acceptance criteria**:
- [ ] Querying for an active report session uses `tipo_sesion='reporte'` in the WHERE clause
- [ ] Querying for an active onboarding session uses `tipo_sesion='onboarding'`
- [ ] A user cannot have two concurrent active `reporte` sessions (UNIQUE constraint on `phone` + `tipo_sesion` + `status='active'` or equivalent guard)

---

## Scenarios

### SC-conversation-001: One clarification is sufficient
**Given** a user sends "apliqué fungicida en el lote de abajo" and an active session does not exist
**When** LLM extraction runs and finds `subtipo` (product name) is null, but `lote_id` resolved successfully
**Then** `clarification_count = 1` and the question "¿Qué fungicida aplicaste?" is sent
**And** the user responds "Mancozeb"
**When** the continuation turn runs with the merged context
**Then** all critical fields are present with confidence >= 0.5
**And** the event is persisted as `tipo_evento='insumo'`
**And** the session is closed with `status='completed'`

---

### SC-conversation-002: Two clarifications complete the event
**Given** a user sends "hice chapeo" (no lote, no detail)
**When** turn 1 extraction finds `lote_id=null` and `subtipo=null`
**Then** clarification question 1 asks: "¿En qué lote hiciste el chapeo?"
**And** `clarification_count = 1`
**When** user responds "en el lote 2"
**And** turn 2 extraction merges context, `lote_id` resolves to F001-L02, but `subtipo=null` (chapeo was not re-stated)
**Then** clarification question 2 asks: "¿Cuántos trabajadores o cuántas jornadas fueron?"
**And** `clarification_count = 2`
**When** user responds "3 jornales"
**Then** extraction completes with all critical fields present
**And** the event is persisted as `tipo_evento='labor'`
**And** no third question is sent

---

### SC-conversation-003: Two clarifications then fallback
**Given** a user sends "pasó algo en el lote"
**When** turn 1 extraction finds no usable information (all fields null, confidence < 0.3)
**Then** the system goes to immediate `nota_libre` fallback (REQ-extraction-007) without asking any question
**And** the user receives "Lo registro como nota y lo revisamos después."

(Scenario for the 2-question-then-fallback path:)

**Given** a user sends "apliqué algo en algún lado"
**When** turn 1 extraction finds `lote_id=null`, `subtipo=null` with moderate confidence
**Then** question 1 asks for `lote_id`
**And** `clarification_count = 1`
**When** user responds with something ambiguous that still cannot resolve the lot
**Then** question 2 asks again (rephrased, with lot list)
**And** `clarification_count = 2`
**When** user responds again but the event remains incomplete
**Then** fallback: event persisted as `nota_libre` with `status='requires_review'`
**And** user receives "Lo registro como nota y lo revisamos después."
**And** no more questions are asked

---

### SC-conversation-004: Session expired mid-conversation
**Given** a user started a clarification turn 45 minutes ago with `clarification_count=1` and never replied
**When** the user sends a new message
**Then** the session lookup finds the record but `expires_at < NOW()`
**And** the session is treated as expired (ignored)
**And** the new message is treated as a fresh report
**And** the `clarification_count` for the new exchange starts at 0

---

### SC-conversation-005: New report while clarification pending
**Given** a user has an active session with `clarification_count=1` for a prior incomplete report
**When** the user sends a completely different new report ("cosecha de 20 quintales en el lote 3")
**Then** the system detects an active session exists
**And** the system MUST close the pending session as `fallback_nota_libre` (the incomplete prior event becomes a nota_libre) before processing the new message as a fresh session
**And** the new report is processed starting with a fresh `clarification_count=0`
