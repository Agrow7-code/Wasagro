# Spec: memory
> Change: sdr-conversacional | Phase: sdd-spec | Date: 2026-04-23

## Overview

Defines cross-session memory for the SDR: how questions and answers are persisted, how context is loaded on session resume, and the guarantee that no question is ever repeated across sessions.

---

## Requirements

### REQ-mem-001: Persistent question-answer log per prospect
**Priority**: MUST
**Rule**: DA-SDR-08

Every discovery question asked AND every answer received MUST be stored in `sdr_prospectos.preguntas_realizadas` as a JSONB array. Each entry records:

```json
{
  "question_id": "Q-EX-02",
  "question_text": "¿Tus compradores europeos te están pidiendo evidencia de trazabilidad?",
  "answer_text": "Sí, mi importador en Alemania nos pidió trazabilidad antes de octubre",
  "dimension": "eudr_urgency",
  "score_delta": 25,
  "evidence_quote": "importador en Alemania nos pidió trazabilidad antes de octubre",
  "turn": 3,
  "session_id": "uuid",
  "answered_at": "ISO8601"
}
```

**Acceptance criteria**:
- [ ] Every discovery question fired adds an entry to `preguntas_realizadas` with `answer_text = null` initially
- [ ] When the prospect's next message answers the question, the entry is updated with `answer_text`, `score_delta`, and `evidence_quote`
- [ ] `preguntas_realizadas` is an append-only structure — no entries are ever deleted or modified after `answer_text` is set
- [ ] The array accurately reflects the complete history across ALL sessions with this prospect

---

### REQ-mem-002: Session resume seeds context from persistent record
**Priority**: MUST
**Rule**: DA-SDR-08

When a prospect sends a new message and an existing `sdr_prospectos` record is found (not new), the SDR session MUST be initialized with:
1. The full `preguntas_realizadas` log (to avoid repeat questions)
2. The current `score_total` and all 6 dimension scores
3. The `segmento_icp` and `narrativa_asignada`
4. The `objeciones_manejadas` list
5. The `punto_de_dolor_principal` if already identified

This context MUST be injected into the LLM call so the LLM knows what it already knows about this prospect.

**Acceptance criteria**:
- [ ] On any message from a phone with an existing `sdr_prospectos` record, `getSDRProspecto(phone)` is called first
- [ ] The returned record seeds a `SDRProspectoContext` object that is passed to `atenderSDR()`
- [ ] The LLM prompt includes a "Lo que ya sé de ti:" section with answered questions and score
- [ ] A prospect who said "manejamos 45 fincas" in session 1 is NEVER asked about farm count in session 2
- [ ] The session can resume DAYS or WEEKS after the last interaction — memory does not expire

---

### REQ-mem-003: No repeated questions
**Priority**: MUST
**Rule**: DA-SDR-08

The SDR MUST check `preguntas_realizadas` before selecting any discovery question. A question with an existing entry (whether answered or unanswered) MUST NOT be asked again.

**Acceptance criteria**:
- [ ] Question selection logic filters out all `question_id` values already in `preguntas_realizadas`
- [ ] If all 7 questions have entries, no new discovery questions are asked — the SDR moves to soft close or exit
- [ ] Unanswered questions (prospect ignored them in a previous session) ARE re-asked in the next session — only answered questions are skipped
- [ ] Test: prospect answered Q-EX-01, Q-EX-02 in session 1. Session 2 starts with Q-EX-03 (not Q-EX-01).

---

### REQ-mem-004: Score persists and accumulates across sessions
**Priority**: MUST

The qualification score is cumulative. Each session adds to the existing score — it never resets. New information in session 2 can increase a dimension score if it provides stronger evidence than session 1.

**Score update rules across sessions**:
- A dimension score can INCREASE if new session provides stronger evidence (e.g. eudr_urgency goes from 8 to 25 when explicit deadline is mentioned)
- A dimension score CANNOT DECREASE (no score decay)
- If the same dimension is scored in two sessions, use the HIGHER score

**Acceptance criteria**:
- [ ] On session resume, `score_total` loaded from `sdr_prospectos` reflects ALL previous sessions
- [ ] If new evidence provides a higher score for an existing dimension, the dimension is updated (not summed — replaced with higher value)
- [ ] `score_total` is always recalculated as the sum of all 6 dimension scores after any update
- [ ] A prospect who scored 55 in session 1 starts session 2 at 55, not 0

---

### REQ-mem-005: Context injection format for LLM
**Priority**: MUST

When a returning prospect is detected, the LLM prompt MUST include a structured context section BEFORE the main conversation prompt:

```
--- CONTEXTO DEL PROSPECTO ---
Este prospecto ya ha hablado contigo antes. Lo que ya sabes:

Nombre: {nombre_contacto}
Empresa: {empresa}
Segmento: {segmento_icp}
Narrativa asignada: {narrativa_asignada}
Score actual: {score_total}/100

Preguntas ya respondidas:
- {question_text}: {answer_text}
- {question_text}: {answer_text}

Dimensiones con score 0 (aún sin responder):
- {dimension}: pendiente
- {dimension}: pendiente

Objeciones ya manejadas: {objeciones_manejadas}
Dolor principal: {punto_de_dolor_principal}
-------------------------------
```

**Acceptance criteria**:
- [ ] This context section is injected into the system prompt when `turns_total > 0` for the prospect
- [ ] For new prospects (`turns_total = 0`), this section is omitted
- [ ] `Preguntas ya respondidas` section only includes questions with non-null `answer_text`
- [ ] The LLM MUST NOT re-ask questions listed in "Preguntas ya respondidas"

---

### REQ-mem-006: Session ID tracked per interaction
**Priority**: MUST

Each set of interactions within a single WhatsApp conversation window corresponds to one `session_id` in `sesiones_activas`. The `sdr_interacciones` table records both the `prospecto_id` and the session context for each turn.

**Acceptance criteria**:
- [ ] A new `sesiones_activas` record with `tipo_sesion = 'sdr'` is created for each new conversation window
- [ ] Existing `sdr_prospectos` record is linked — the session references the prospect
- [ ] Session TTL is 60 minutes (longer than the 30-minute report session TTL — SDR conversations can have longer pauses)
- [ ] When session expires and prospect returns, a new session is created but `sdr_prospectos` is resumed (persistent memory)

---

## Scenarios

### SC-mem-01: Returning prospect — no repeated questions

**Given**: Prospect last messaged 3 days ago. Answered Q-EX-01 (45 fincas), Q-EX-02 (EUDR urgency = alta). score_total = 50.

**When**: Prospect sends new message "Hola, volví para saber más".

**Then**: New `sesiones_activas` session created. `sdr_prospectos` loaded with score=50, answered questions. LLM context includes "Lo que ya sé: 45 fincas, EUDR urgencia alta". First question asked is Q-EX-03 (calidad_dato) — the next unanswered highest-priority question.

---

### SC-mem-02: Score accumulation across sessions

**Given**: Session 1: score = 48 (tamano_cartera=15, eudr_urgency=8, calidad_dato=20, champion=5). Session 2: prospect clarifies "somos los responsables de la decisión — yo tomo la decisión final".

**When**: champion dimension updates in session 2 (evidence of decision maker = 15 pts).

**Then**: `score_champion` updates from 5 → 15. `score_total` = 48 + 10 = 58. (Delta = 10, not 15, because existing champion score was 5, new is 15, diff = 10.) Prospect closer to threshold.

---

### SC-mem-03: All 7 questions answered, session moves to close

**Given**: All 7 `question_id` values have `answer_text` set. score_total = 60 (below threshold).

**When**: New message from prospect arrives.

**Then**: No new discovery questions. SDR moves to soft close: "Basándome en lo que me contaste, creo que Wasagro puede ser una muy buena solución para tu operación. ¿Le darías una oportunidad a una demostración de 20 minutos?" — this is the meeting request, not a discovery question.

---

### SC-mem-04: Ignored question re-asked in next session

**Given**: Session 1 asked Q-EX-04 (champion decision maker). Prospect never answered — changed topic. `preguntas_realizadas` has Q-EX-04 with `answer_text = null`.

**When**: Session 2 starts.

**Then**: Q-EX-04 IS re-asked (it has no answer). System presents it naturally: "Una cosa que nunca me quedó clara — ¿tú tomarías la decisión de implementar algo así, o habría que involucrar a otros?"
