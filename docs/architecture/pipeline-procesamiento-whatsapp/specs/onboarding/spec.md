# Spec: onboarding
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers the blocking onboarding survey flow that must be completed before a user can submit field reports. Includes the 5-step conversational survey, consent capture with legal requirements, farm and lot registration, provisional data handling when first message contains useful content, and mid-onboarding resumption.

---

## Requirements

### REQ-onboarding-001: Onboarding is blocking
**Priority**: MUST
**Rule**: P6 (consent before capture), P1 (no data without proper context)

No field event reports MUST be accepted from a user until `onboarding_completo=true` is set on their `usuarios` record. This check happens in `flujo-01-recibir-mensaje` before any routing to `flujo-02-procesar-reporte`. Any message (text, audio, image) from a user with `onboarding_completo=false` MUST be routed to `flujo-03-onboarding` regardless of content. The user MUST be informed they need to complete setup first.

**Acceptance criteria**:
- [ ] A user with `onboarding_completo=false` who sends "apliqué 3 bombadas de urea en el lote 2" does NOT trigger event extraction
- [ ] The user receives an onboarding continuation message instead of an event confirmation
- [ ] `flujo-02-procesar-reporte` is never invoked for users with `onboarding_completo=false`

---

### REQ-onboarding-002: 5-step conversational survey
**Priority**: MUST

The onboarding flow MUST proceed through exactly these 5 steps in order:

| Step | Content | DB action |
|------|---------|-----------|
| 1 | Welcome + ask for name and role | INSERT `usuarios` with `phone`, `onboarding_completo=false` |
| 2 | Consent request (P6 — exact text shown) | INSERT `user_consents` if accepted |
| 3 | Farm data: name, location, main crop | INSERT `fincas` |
| 4 | Lot list: colloquial names, codes, optional hectares | INSERT `lotes` |
| 5 | Activation confirmation | UPDATE `usuarios` SET `onboarding_completo=true` |

Each step MUST be completed before advancing to the next. The current step MUST be stored in `sesiones_activas` (or in `usuarios.onboarding_step`) so the flow can resume if the user abandons mid-session.

**Acceptance criteria**:
- [ ] A user cannot reach step 3 without consent being given in step 2
- [ ] Completing step 5 sets `onboarding_completo=true` and enables report submission
- [ ] The step number is queryable so onboarding can resume from the correct step
- [ ] Each step sends at most 1 message to the user before waiting for their response

---

### REQ-onboarding-003: Consent capture with exact text stored
**Priority**: MUST
**Rule**: P6 (consent MUST document timestamp, type, and exact text shown)

Step 2 MUST send the user the exact consent text as defined in the consent template. The INSERT into `user_consents` MUST store: `user_id`, `phone`, `tipo='datos'`, `texto_mostrado` (verbatim copy of the consent message sent), `aceptado=true`, and `timestamp`. The stored `texto_mostrado` MUST be identical to what was actually sent — not a reference or summary. If consent is rejected, `aceptado=false` MUST be stored (not omitting the record) and the flow MUST stop.

**Acceptance criteria**:
- [ ] `user_consents.texto_mostrado` contains the full verbatim consent text, not a key or template ID
- [ ] `user_consents.timestamp` is the moment the user sent the acceptance response (not when the system sent the question)
- [ ] A user who types "no" or "no acepto" triggers `aceptado=false` insert and flow termination
- [ ] The system message after consent rejection explains clearly that no data will be captured and they can contact again later

---

### REQ-onboarding-004: Lot list capture and lot_id assignment
**Priority**: MUST
**Rule**: R1 (accurate lot context prevents fabrication in extraction)

Step 4 MUST capture the user's lot list in a natural language format. The user may name lots however they want ("el de arriba", "lote 3", "la quebrada", "el nuevo"). Each named lot MUST be assigned a canonical `lote_id` in format `{finca_id}-L{NN}` (e.g. `F001-L01`, `F001-L02`). The `nombre_coloquial` MUST be stored as-is from the user's response. Hectares MUST be captured if mentioned, otherwise null. After collecting the list, the system MUST confirm it back to the user: "Registré estos lotes: [list]. ¿Está bien?" and wait for confirmation before proceeding to step 5.

**Acceptance criteria**:
- [ ] A user who names 3 lots gets 3 `lotes` records with sequential `lote_id` values
- [ ] `nombre_coloquial` is stored verbatim — not normalized or corrected by the system
- [ ] The confirmation message lists all captured lots and waits for user confirmation before step 5
- [ ] If the user says "no" to the confirmation, they can correct the list before proceeding
- [ ] Lot hectares are `null` if not mentioned — never guessed (R1)

---

### REQ-onboarding-005: Provisional data handling on first-message consent
**Priority**: MUST
**Rule**: P6, R3

If a user's very first WhatsApp message contains useful field event data (e.g. "hoy apliqué urea en el lote 3") BEFORE onboarding is complete, the system MUST process this as provisional data in-memory (not persisted to `eventos_campo`). The system MUST then initiate onboarding. At step 2 (consent):
- If the user accepts consent: the provisional data MUST be persisted to `eventos_campo` as a normal event
- If the user rejects consent: the provisional data MUST be discarded (not persisted anywhere)

The provisional data MUST NOT be stored in `eventos_campo` before consent is confirmed. It MAY be held in the session's `contexto_parcial` JSONB field temporarily.

**Acceptance criteria**:
- [ ] A first-contact audio/text with field event content does NOT insert into `eventos_campo` before consent
- [ ] After consent acceptance, the provisionally-held data is persisted with the correct `finca_id` (available after step 3)
- [ ] After consent rejection, `contexto_parcial` is cleared and no trace of the data remains in the DB
- [ ] The user is informed at step 2 that their first message will be registered once they accept (transparent communication)

---

### REQ-onboarding-006: Mid-onboarding resumption
**Priority**: MUST

If a user abandons onboarding (session expires, no response for 30+ minutes, or closes WhatsApp), the flow MUST be resumable from the last successfully completed step. The current step number MUST be persisted in a durable location (Supabase — not n8n memory). When the user sends a new message, the system MUST detect the incomplete onboarding and resume from the correct step with a context reminder ("Quedamos en el paso X, continuamos?").

**Acceptance criteria**:
- [ ] A user who completed step 2 (consent) and abandoned resumes from step 3 (farm data) on next message
- [ ] The system does NOT restart onboarding from step 1 for a user who has already given consent
- [ ] The resumption message includes context of what was already completed
- [ ] If a user's session has expired but their `usuarios` record exists with an intermediate step, the system reads the step from `usuarios` (or a durable field), not from the expired session

---

### REQ-onboarding-007: LangFuse tracing for onboarding
**Priority**: SHOULD
**Rule**: R4

Onboarding steps that use LLM calls (lot list parsing in step 4 uses GPT-4o Mini to parse natural language lot names) MUST be logged in LangFuse with a trace named `onboarding_{phone_hash}`. Non-LLM steps (consent capture, DB writes) are not required to create LangFuse spans but the onboarding trace MUST be created and closed.

**Acceptance criteria**:
- [ ] The lot list parsing LLM call (step 4) has a LangFuse span with `input_raw`, `output`, `model`, `latency_ms`, `cost_usd`
- [ ] The onboarding trace is closed when step 5 completes or when the user rejects consent
- [ ] A rejection at step 2 closes the trace with status `rejected_consent`, not `error`

---

## Scenarios

### SC-onboarding-001: Complete happy path
**Given** a new user sends "Hola, quiero empezar a usar el sistema"
**When** `flujo-01` detects the phone is not in `usuarios`
**Then** `flujo-03-onboarding` starts
**And** step 1 sends: welcome message + asks for name and role; user responds "Juan, agricultor"
**And** step 2 sends the consent text; user responds "sí, acepto"
**And** `user_consents` is inserted with `aceptado=true`, `texto_mostrado` = verbatim consent text
**And** step 3 asks for farm data; user provides name, location, main crop; `fincas` is inserted
**And** step 4 asks for lots; user says "tengo tres: el de arriba, el del río y el nuevo"; all three `lotes` records are inserted; system confirms the list; user says "sí, correcto"
**And** step 5 sends activation confirmation
**And** `usuarios.onboarding_completo` is set to `true`
**And** the user can now send field reports

---

### SC-onboarding-002: Consent rejection
**Given** a new user reaches step 2 and receives the consent text
**When** the user responds "no acepto, no quiero que guarden mis datos"
**Then** `user_consents` is inserted with `aceptado=false`
**And** the system sends a message explaining no data will be captured and they can contact again later
**And** `flujo-03-onboarding` terminates
**And** the user's `usuarios` record has `onboarding_completo=false` and `consentimiento_datos=false`
**And** no farm or lot data is inserted
**And** any provisional first-message data is discarded

---

### SC-onboarding-003: Abandoned mid-onboarding, then resumed
**Given** a user completed steps 1 and 2 (consent accepted) but abandoned without completing step 3
**When** the user sends a new message 2 hours later
**Then** `flujo-01` detects the phone has `onboarding_completo=false`
**And** `flujo-03-onboarding` is triggered
**And** the flow detects the user is at step 3 (consent already done)
**And** the system sends: "Ya tenemos tu consentimiento registrado, sigamos con los datos de tu finca."
**And** step 3 proceeds normally without repeating steps 1 or 2

---

### SC-onboarding-004: First message with useful data, consent accepted
**Given** a user's very first message is "hoy apliqué 5 bombadas de Mancozeb en el lote 3"
**When** `flujo-01` detects this is a first-contact user
**Then** the message content is held provisionally in `contexto_parcial` (not inserted into `eventos_campo`)
**And** onboarding starts from step 1
**And** the system informs the user: "Vi que ya querés reportar, vamos a registrar tu finca primero y después guardamos ese reporte."
**When** the user completes all 5 onboarding steps and accepts consent
**Then** the provisional event data is persisted to `eventos_campo` using the now-available `finca_id`
**And** the user receives confirmation of the original report plus the activation message

---

### SC-onboarding-005: First message with useful data, consent rejected
**Given** same as SC-onboarding-004 but the user rejects consent at step 2
**When** consent is rejected
**Then** the provisional data in `contexto_parcial` is discarded
**And** NO INSERT into `eventos_campo` occurs for the original report content
**And** the system confirms no data was saved
**And** the `usuarios` record has `consentimiento_datos=false`
