# Spec: extraction
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers the AI extraction pipeline that converts raw input (post-STT text, direct text, or vision analysis output) into structured field events. Includes STT transcription, STT post-correction for agricultural terminology, vision analysis for images, LLM-based structured extraction, and completeness validation.

---

## Requirements

### REQ-extraction-001: LLM extraction with null-first rule
**Priority**: MUST
**Rule**: R1 (agent never invents data), P1

The extraction LLM (GPT-4o Mini) MUST be called with a system prompt that contains an explicit, unambiguous instruction: "If you cannot extract a field from the input, return `null` for that field with a `confidence_score` below 0.5. NEVER assume, infer beyond what is stated, or fabricate a value." The output MUST be a JSON object with: `tipo_evento`, the type-specific extracted fields (see REQ-extraction-003), and `confidence_score` as a per-field map (values 0.0–1.0).

**Acceptance criteria**:
- [ ] A message missing `lote_id` produces `lote_id: null` with `confidence_score["lote_id"] < 0.5` — never a guessed lote
- [ ] A message that is completely unintelligible (e.g. noise-only transcription) produces all critical fields as `null`
- [ ] The extraction output JSON schema is validated before downstream use; a schema violation causes an error log and fallback to `nota_libre`

---

### REQ-extraction-002: Farm context injection into extraction prompt
**Priority**: MUST
**Rule**: R1 (accurate lote_id resolution without invention), supports D7 (semantic resolution by LLM)

The system prompt for LLM extraction MUST include the requesting user's farm context: `finca_id`, `cultivo_principal`, and the full list of active lots with both `lote_id` (F001-L01 format) and `nombre_coloquial` (e.g. "lote de arriba", "lote 3", "la quebrada"). This context enables the LLM to resolve colloquial lot references to their canonical `lote_id` without inventing non-existent lots. If the user mentions a lot name that does not match any in the injected list, the LLM MUST return `lote_id: null` with a note in the output, not invent a new lote_id.

**Acceptance criteria**:
- [ ] The extraction prompt includes the complete lot list for the user's farm at call time
- [ ] "el lote de arriba" resolves to the correct `lote_id` when a matching `nombre_coloquial` exists in the injected list
- [ ] A mention of "lote 7" when the farm has no lot 7 produces `lote_id: null`, not `F001-L07`
- [ ] The agricultural glossary (bombada, caneca, quintal, jornal, escoba, helada, etc.) is included in the system prompt

---

### REQ-extraction-003: Support for all 7 event types with mandatory fields
**Priority**: MUST
**Rule**: R1 (only persist what was said)

The extraction pipeline MUST support exactly these seven `tipo_evento` values and their corresponding mandatory fields:

| tipo_evento | Critical field 1 | Critical field 2 | Nullable fields |
|-------------|-----------------|------------------|-----------------|
| `labor`     | `lote_id`       | `subtipo` (labor type) | `num_trabajadores`, `modalidad` |
| `insumo`    | `lote_id`       | `subtipo` (product name) | `cantidad`, `unidad`, `area_ha` |
| `plaga`     | `lote_id`       | `subtipo` (plague type) | `severidad` (default `moderada` with confidence=0.4 if not stated), `area_afectada_ha` |
| `clima`     | `subtipo` (event type) | — (lote_id optional, may be finca-level) | `intensidad`, `duracion` |
| `cosecha`   | `lote_id`       | `cantidad` + `unidad` | `rechazo_pct`, `brix` |
| `gasto`     | `subtipo` (concept) | `cantidad` (amount) | `lote_id`, `moneda` (default USD) |
| `observacion` | `descripcion_raw` | — | all other fields null |

A field that is missing AND critical triggers a clarification request (see conversation/spec.md). A field that is missing AND nullable is persisted as `null` — no clarification requested for nullable fields.

**Acceptance criteria**:
- [ ] Each of the 7 event types maps to a distinct output shape in `datos_evento` JSONB
- [ ] `severidad` for `plaga` defaults to `"moderada"` with `confidence_score=0.4` only when no severity cue is present in the text; this default is NOT treated as a fabricated value (it is explicitly documented as a domain default)
- [ ] `tipo_evento='observacion'` is used as the fallback when no other type can be confidently determined (confidence >= 0.5)
- [ ] The extraction prompt includes the mandatory/nullable distinction per type so the model knows which nulls trigger clarification

---

### REQ-extraction-004: STT transcription for audio messages
**Priority**: MUST
**Rule**: R4 (every LLM/STT call logged), D4 (GPT-4o Mini Transcribe)

Audio messages in `.opus` format MUST be transcribed using GPT-4o Mini Transcribe. The STT call MUST be parametrized by a configuration variable (not hardcoded model name) to enable migration if H-TEC-02 invalidates this model choice. The raw transcription output MUST be passed to post-correction before extraction (REQ-extraction-005). Every STT call MUST produce a LangFuse span (see observability/spec.md REQ-observability-002).

**Acceptance criteria**:
- [ ] Audio is downloaded from Meta's Graph API and passed to the STT model as binary `.opus`
- [ ] The transcription result is stored as `contenido_raw` in `mensajes_entrada` before post-correction
- [ ] The STT model identifier is read from a configuration variable, not hardcoded in the flow
- [ ] STT errors (timeout, API error) are caught, logged to LangFuse, and the user receives a graceful error message asking them to resend or type the report

---

### REQ-extraction-005: STT post-correction for agricultural terminology
**Priority**: MUST
**Rule**: R1 (accuracy before extraction), supports WER mitigation

After STT transcription, the raw text MUST be passed through a post-correction LLM call (GPT-4o Mini) with a system prompt containing the agricultural glossary from CLAUDE.md. The post-correction MUST fix domain-specific errors (e.g. "la rolla" → "la roya", "helada" → context-dependent: moniliasis if disease context, else climate event) without altering the meaning or inventing information not present in the original audio. The corrected text, not the raw transcription, is the input to REQ-extraction-001.

**Acceptance criteria**:
- [ ] The post-correction prompt includes: bombada, caneca, quintal/qq, jornal, colino, escoba, helada, riel, mazorca negra, rechazo, brix, and other glossary terms from CLAUDE.md
- [ ] Post-correction does NOT add fields, quantities, or lote names not present in the original transcription
- [ ] Both raw transcription and post-corrected text are logged (LangFuse span `stt_post_correccion`)
- [ ] If the raw and corrected texts are identical (no corrections needed), this is logged as-is — no fabrication

---

### REQ-extraction-006: Vision analysis for image messages
**Priority**: MUST
**Rule**: R1 (describe only what is observable)

Image messages MUST be analyzed with GPT-4o Mini Vision before LLM extraction. The vision analysis system prompt MUST instruct the model to describe ONLY what is visually observable — no inference beyond what is visible. Output MUST be a structured description: visible plague or disease (if any), crop state, quantification if discernible, and any text visible in the image. The caption (if present) MUST be included as additional context to the vision model. The vision analysis output, combined with the caption, serves as the text input to REQ-extraction-001.

**Acceptance criteria**:
- [ ] An image with no caption still produces a vision analysis output used as input to extraction
- [ ] An image with a caption uses both the visual analysis AND caption text as the extraction input
- [ ] The vision model output explicitly flags when it cannot determine crop type or plague type from the image
- [ ] Vision analysis does NOT fabricate quantities, lot IDs, or product names not visible in the image

---

### REQ-extraction-007: Completeness validation post-extraction
**Priority**: MUST
**Rule**: R2 (max 2 clarifications), R1 (no fabrication to fill gaps)

After LLM extraction, the system MUST validate whether all critical fields for the detected `tipo_evento` are present with `confidence_score >= 0.5`. If any critical field is missing or has low confidence, the system MUST route to the clarification flow (see conversation/spec.md). If `confidence_score < 0.3` for ALL critical fields, or if all critical fields are `null`, the system MUST skip clarification and immediately create a `nota_libre` with `status='requires_review'` — no questions asked, because there is nothing useful to work from.

**Acceptance criteria**:
- [ ] All critical fields present with confidence >= 0.5 → event persisted directly, no clarification
- [ ] One or two critical fields missing → clarification requested (up to the conversation limit)
- [ ] All critical fields null or confidence < 0.3 → immediate `nota_libre` with `status='requires_review'`
- [ ] The `completeness_score` (fraction of critical fields present) is logged as a LangFuse score

---

## Scenarios

### SC-extraction-001: Happy path — complete fumigation audio report
**Given** a user sends an audio message: "Hoy apliqué cinco bombadas de Mancozeb en el lote de arriba, lote F001-L02"
**When** the pipeline processes the audio
**Then** STT produces a transcription with "cinco bombadas de Mancozeb"
**And** post-correction confirms "bombadas" is correctly a unit of measure (20L each)
**And** LLM extraction produces: `tipo_evento='insumo'`, `subtipo='Mancozeb'`, `cantidad=5`, `unidad='bombadas'`, `lote_id='F001-L02'` (resolved from "lote de arriba" via context), all with `confidence_score >= 0.8`
**And** completeness validation passes (all critical fields present)
**And** the event is persisted directly without clarification

---

### SC-extraction-002: Incomplete report — missing lote_id
**Given** a user sends the text "Apliqué 3 bombadas de urea hoy"
**When** LLM extraction runs
**Then** `tipo_evento='insumo'`, `subtipo='urea'`, `cantidad=3`, `unidad='bombadas'` are extracted with confidence >= 0.7
**And** `lote_id=null` with `confidence_score["lote_id"] < 0.5` because no lot was mentioned
**And** completeness validation detects `lote_id` as a missing critical field
**And** a clarification question is sent: "¿En qué lote aplicaste la urea?" (with the lot list if the farm has multiple lots)
**And** `clarification_count` in `sesiones_activas` is set to 1

---

### SC-extraction-003: Noisy audio — partial transcription
**Given** a user sends a 30-second audio with significant background noise, and STT produces "aplicar... [inaudible]... lote... cuatro... bombadas"
**When** the pipeline processes it
**Then** post-correction does not fabricate words not in the transcription
**And** LLM extraction produces partial results with several null fields and low confidence scores
**And** if all critical fields are null or confidence < 0.3, the event goes directly to `nota_libre` with `status='requires_review'` without asking clarification questions
**And** the user receives: "Lo registro como nota y lo revisamos después."

---

### SC-extraction-004: Image with caption
**Given** a user sends a JPEG image of a banana leaf with Sigatoka, with caption "lote 3 bastante afectado"
**When** vision analysis runs
**Then** the vision model identifies yellow Sigatoka lesions on banana leaves
**And** the extraction uses both the vision description and the caption text
**And** LLM extraction produces: `tipo_evento='plaga'`, `subtipo='Sigatoka'`, `severidad='moderada'` (inferred from "bastante afectado"), `lote_id` resolved from "lote 3" via context
**And** the event is persisted if all critical fields are present

---

### SC-extraction-005: Image without caption
**Given** a user sends a JPEG image of a diseased plant with NO caption
**When** vision analysis runs
**Then** the vision model produces a description of what is observable (plant, symptoms, no lot info)
**And** LLM extraction cannot determine `lote_id` (not in image, not in caption)
**And** `lote_id=null` triggers a clarification question: "¿En qué lote tomaste la foto?"
**And** `clarification_count` is set to 1

---

### SC-extraction-006: Ambiguous lot name — no match in context
**Given** a user sends "Hice chapeo en el lote nuevo" and the farm's lot list contains F001-L01 ("lote de arriba"), F001-L02 ("lote del río") — no "lote nuevo"
**When** LLM extraction runs with the farm's lot context
**Then** the LLM returns `lote_id=null` because "lote nuevo" does not match any `nombre_coloquial` in the injected list
**And** `confidence_score["lote_id"] < 0.5`
**And** a clarification question lists the available lots: "¿En cuál lote hiciste el chapeo? Tengo: lote de arriba (L01) o lote del río (L02)."

---

### SC-extraction-007: All-null extraction — immediate nota_libre
**Given** a user sends an audio that STT transcribes as mostly unintelligible noise with no recognizable field event content
**When** LLM extraction runs
**Then** all critical fields return as `null` with `confidence_score < 0.3`
**And** the system does NOT ask clarification questions
**And** the event is persisted as `tipo_evento='observacion'` / `nota_libre` with `status='requires_review'` and `descripcion_raw` set to the post-corrected transcription
**And** the user receives: "Lo registro como nota y lo revisamos después."
