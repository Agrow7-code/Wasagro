# Spec: observability
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-spec | Date: 2026-04-10

## Overview

Covers LangFuse tracing requirements for every message that enters the LLM pipeline: mandatory spans, required fields per span, error path logging, evaluation scores, and the absolute prohibition on silent catch blocks. Every call to an LLM or STT model MUST produce a traceable, auditable record.

---

## Requirements

### REQ-observability-001: LangFuse trace per pipeline message
**Priority**: MUST
**Rule**: R4 (every LLM/STT call logged — no silent errors)

Every message that enters `flujo-02-procesar-reporte` MUST generate a LangFuse trace named `whatsapp_message_{wamid}`. The trace MUST be created at the start of `flujo-02` execution and closed (with final scores) at the end. Metadata on the trace root MUST include: `phone` (masked/hashed if PII concern), `finca_id`, `tipo_mensaje` (text/audio/image), `wamid`. Traces for onboarding sessions MUST be named `onboarding_{phone_hash}` and are separate from report traces.

**Acceptance criteria**:
- [ ] Every message passing through `flujo-02` has a corresponding trace in LangFuse
- [ ] The trace name follows the `whatsapp_message_{wamid}` convention, enabling lookup by wamid
- [ ] Trace metadata includes `finca_id` and `tipo_mensaje`
- [ ] Traces are closed (not left open/pending) regardless of whether the pipeline succeeded or failed

---

### REQ-observability-002: Required spans per pipeline path
**Priority**: MUST
**Rule**: R4

Each pipeline path MUST produce the following spans within its trace:

**All messages:**
- `autenticar_usuario` — user lookup latency
- `verificar_consentimiento` — consent check result
- `validar_completitud` — fields present/missing, completeness_score
- `persistir_evento` — DB write result

**Audio messages additionally:**
- `descargar_media` — media download latency and size
- `stt_transcripcion` — transcription call (see REQ-observability-003)
- `stt_post_correccion` — post-correction call (see REQ-observability-003)

**Image messages additionally:**
- `descargar_media` — media download latency and size
- `vision_analisis` — vision model call (see REQ-observability-003)

**All messages with LLM extraction:**
- `llm_extraccion` — main extraction call (see REQ-observability-003)

**Clarification turns additionally:**
- `clarification_turn_{n}` — span for each clarification turn, including the question sent and field being asked

**Acceptance criteria**:
- [ ] A text message trace contains exactly: `autenticar_usuario`, `verificar_consentimiento`, `llm_extraccion`, `validar_completitud`, `persistir_evento`
- [ ] An audio message trace contains all text spans plus `descargar_media`, `stt_transcripcion`, `stt_post_correccion`
- [ ] An image message trace contains all text spans plus `descargar_media`, `vision_analisis`
- [ ] A multi-turn clarification adds `clarification_turn_1` (and `clarification_turn_2` if needed)

---

### REQ-observability-003: Mandatory fields per LLM/STT span
**Priority**: MUST
**Rule**: R4 (input, output, model, latency must all be logged)

Each LLM or STT span MUST log ALL of the following fields without exception:

| Field | Type | Required for |
|-------|------|-------------|
| `input_raw` | string | all LLM/STT spans |
| `output` | string/JSON | all LLM/STT spans |
| `model` | string | all LLM/STT spans |
| `latency_ms` | integer | all LLM/STT spans |
| `cost_usd` | float | all LLM/STT spans |
| `tokens_input` | integer | LLM spans only |
| `tokens_output` | integer | LLM spans only |
| `confidence_score` | float or map | `llm_extraccion` span |
| `audio_ref` | string | `stt_transcripcion` span |
| `duration_sec` | float | `stt_transcripcion` span |

For the `stt_post_correccion` span, `input_raw` is the raw transcription and `output` is the corrected text. For `llm_extraccion`, `input_raw` is the full prompt text (with context injected) and `output` is the full JSON response.

**Acceptance criteria**:
- [ ] No LLM or STT call completes without all required fields present in its LangFuse span
- [ ] A span with missing `cost_usd` or `latency_ms` is treated as an instrumentation bug and must be fixed (not shipped)
- [ ] `confidence_score` on the `llm_extraccion` span is the per-field map from the extraction output, not a single aggregated score

---

### REQ-observability-004: No silent catch blocks
**Priority**: MUST
**Rule**: R4

No try-catch, error handler, or exception path in the pipeline is permitted to silently discard an error. Every caught error MUST produce a LangFuse span or event with: the error type, the error message, the input that caused the error, and a timestamp. After logging, the error MAY be handled gracefully (e.g. fallback to `nota_libre`, user-facing message), but the log MUST happen BEFORE the graceful handler runs.

**Acceptance criteria**:
- [ ] An STT API timeout produces a LangFuse error event before the user receives "No pude procesar el audio..."
- [ ] An LLM extraction API error produces a LangFuse error event before the fallback to `nota_libre` is triggered
- [ ] A DB connection error produces a LangFuse error event; the user receives a generic error message
- [ ] No n8n flow node has an error path that terminates without a LangFuse log step

---

### REQ-observability-005: Evaluation scores on traces
**Priority**: MUST
**Rule**: R4, supports H-TEC-02 (WER measurement) and ongoing quality monitoring

Each closed trace MUST have the following scores attached before closure:

| Score name | Type | Source |
|------------|------|--------|
| `confidence_score` | float 0-1 | Average of per-field confidence scores from extraction |
| `completeness_score` | float 0-1 | Fraction of critical fields present with confidence >= 0.5 |
| `requiere_validacion` | boolean | True if any critical field has confidence < 0.5 |

For STT traces (audio messages), the following fields MUST be present but MAY be null at pipeline time (filled in by human reviewers later):
- `wer_score` — Word Error Rate (filled by reviewer for H-TEC-02)
- `domain_correction_needed` — whether post-correction changed the transcription
- `audio_quality` — `clear`, `noisy`, or `partial_signal` (filled by reviewer)

**Acceptance criteria**:
- [ ] Every closed trace has `confidence_score`, `completeness_score`, and `requiere_validacion` scores
- [ ] Audio message traces have `domain_correction_needed` set at pipeline time (true/false based on whether raw and corrected transcriptions differ)
- [ ] `wer_score` and `audio_quality` are present as null fields in audio traces, ready for human annotation
- [ ] The `completeness_score=0` case (all-null extraction) is distinguishable from `completeness_score=1` (fully complete)

---

### REQ-observability-006: LangFuse dataset tagging for eval corpus
**Priority**: SHOULD

The first 30 audio message traces (corresponding to REQ-persistence-005 eval audio storage) MUST be tagged in LangFuse with `dataset='audio-eval-h0'` to form the evaluation dataset for H-TEC-02. This tagging MUST happen at trace closure, not retroactively.

**Acceptance criteria**:
- [ ] Traces 1–30 for audio messages have the `dataset='audio-eval-h0'` tag
- [ ] The tag is applied at trace closure, before the trace is persisted to LangFuse
- [ ] Traces after the 30-audio threshold are NOT tagged with `audio-eval-h0`

---

## Scenarios

### SC-observability-001: Successful trace with all spans (audio)
**Given** a user sends an audio message that is fully processed into a complete `insumo` event
**When** `flujo-02` completes successfully
**Then** a LangFuse trace `whatsapp_message_{wamid}` is created with status `success`
**And** the trace contains spans: `autenticar_usuario`, `verificar_consentimiento`, `descargar_media`, `stt_transcripcion`, `stt_post_correccion`, `llm_extraccion`, `validar_completitud`, `persistir_evento`
**And** each span has `latency_ms`, `model`, `cost_usd`, and `input_raw`/`output` populated
**And** the trace has `confidence_score`, `completeness_score=1.0`, `requiere_validacion=false` scores attached
**And** `domain_correction_needed` is set to `true` or `false` based on STT correction result

---

### SC-observability-002: STT error logged before graceful fallback
**Given** a user sends an audio message and the GPT-4o Mini Transcribe API returns a 503 timeout
**When** the `stt_transcripcion` span catches the error
**Then** a LangFuse error event is logged within the `stt_transcripcion` span with: error type (`api_timeout`), error message, and `audio_ref`
**And** ONLY AFTER logging, the user-facing message is sent: "No pude procesar el audio, ¿podés enviarlo de nuevo o escribirlo como texto?"
**And** the trace is closed with status `error` and the span `stt_transcripcion` marked as failed
**And** no silent discard occurs

---

### SC-observability-003: LLM extraction timeout logged
**Given** a text message triggers LLM extraction and the GPT-4o Mini API does not respond within the configured timeout
**When** the `llm_extraccion` span catches the timeout
**Then** a LangFuse error event is logged with: `error_type='llm_timeout'`, `model='gpt-4o-mini'`, `input_raw` (the full prompt), `latency_ms` at time of timeout
**And** the pipeline falls back to persisting as `nota_libre` with `status='requires_review'`
**And** the trace is closed with `completeness_score=0` and `requiere_validacion=true`

---

### SC-observability-004: Multi-turn trace with clarification
**Given** a text message requires 1 clarification turn before the event is complete
**When** the pipeline runs across 2 turns
**Then** BOTH turns contribute to the same LangFuse trace (identified by the original `wamid` or a session-level trace ID)
**And** the trace includes `clarification_turn_1` span with: field asked (`lote_id`), question text sent, and timestamp
**And** the final `llm_extraccion` span in turn 2 has the merged context as `input_raw`
**And** the trace scores reflect the final completed state (`completeness_score=1.0`)
