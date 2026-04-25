# Spec: qualification
> Change: sdr-conversacional | Phase: sdd-spec | Date: 2026-04-23

## Overview

Defines the 6-dimension qualification scoring model (0–100), score update rules, thresholds, and the scenarios that trigger each scoring action. The score determines SDR actions: continue discovery, propose pilot, or gracefully exit.

---

## Requirements

### REQ-qual-001: Six-dimension scoring model, 0–100 total
**Priority**: MUST
**Rule**: DA-SDR-06

The system MUST score every prospect across exactly six dimensions. Total score is the sum of all dimension scores. Dimensions and maximum weights:

| Dimension | Max Points | What it measures |
|-----------|-----------|-----------------|
| `eudr_urgency` | 25 | Regulatory pressure from EU Deforestation Regulation |
| `tamano_cartera` | 20 | Number of farms in prospect's portfolio |
| `calidad_dato` | 20 | Current data capture quality (more manual = more pain) |
| `champion` | 15 | Whether the contact has buying power |
| `timeline_decision` | 10 | How soon they can make a decision |
| `presupuesto` | 10 | Budget availability signal |

**Total**: 100 points maximum.

**Acceptance criteria**:
- [ ] Score is stored per-dimension in `sdr_prospectos` (6 columns) plus `score_total`
- [ ] `score_total` always equals the sum of the 6 dimension columns
- [ ] A prospect who has answered no questions has score_total = 0
- [ ] Score can only increase or stay the same — no score decay within a change cycle
- [ ] LangFuse receives `score_delta` on every score update with changed dimension and delta value

---

### REQ-qual-002: eudr_urgency scoring rules
**Priority**: MUST
**Rule**: R1 (no invented urgency), SDR-G4 (no artificial urgency)

| Signal | Points | Evidence required |
|--------|--------|------------------|
| Explicitly mentions EUDR deadline, fines, or lost contract risk | 25 | Direct statement from prospect |
| Aware of EUDR but no urgency expressed | 15 | Mentions EUDR without pressure framing |
| Export market context with no EUDR mention | 8 | Sells to Europe or US; EUDR not mentioned |
| No international market, no EUDR signal | 0 | No evidence of export market |

The SDR MUST NOT manufacture EUDR urgency. If a prospect says "mi comprador en Europa me está presionando", score 25. If the SDR says "¿sabes que el EUDR entra en vigor pronto?" and the prospect says "ah sí", score is 8 (context, not expressed urgency).

**Acceptance criteria**:
- [ ] Score 25 requires explicit prospect statement about EUDR pressure or deadline risk
- [ ] Score 0 is the default until evidence of export market is detected
- [ ] LLM output includes `evidence_quote` for each non-zero EUDR score — the exact phrase that triggered it
- [ ] The `evidence_quote` is stored in `preguntas_realizadas` alongside the score delta

---

### REQ-qual-003: tamano_cartera scoring rules
**Priority**: MUST

| Signal | Points |
|--------|--------|
| 50+ farms in portfolio | 20 |
| 20–49 farms | 15 |
| 10–19 farms | 10 |
| 5–9 farms | 5 |
| <5 farms or individual farm only | 0 |

"Farms" means distinct producer units under the prospect's supervision or purchasing relationship.
For gerente_finca segment: the score applies to their own farm hectares mapped to equivalent complexity (20+ ha = 10pts, <20 ha = 5pts).

**Acceptance criteria**:
- [ ] Score updates the moment a specific number is extracted from conversation
- [ ] If prospect gives a range ("entre 30 y 40"), use the lower bound (R1: no invented data)
- [ ] `fincas_en_cartera` field in `sdr_prospectos` is populated from the extracted number

---

### REQ-qual-004: calidad_dato scoring rules
**Priority**: MUST

| Signal | Points |
|--------|--------|
| No current system — workers report verbally or not at all | 20 |
| Manual logging only (libreta, libros de campo) | 18 |
| WhatsApp messages between workers but no structure | 15 |
| Excel spreadsheets updated manually | 12 |
| Partial software (simple agri app, basic ERP) | 5 |
| Existing full traceability system | 0 |

Higher score = more pain from bad data = stronger buying signal.

**Acceptance criteria**:
- [ ] Score defaults to 0 until prospect describes current data capture
- [ ] The LLM extracts the data quality signal from the conversation and maps it to one of the 6 levels
- [ ] If prospect mentions multiple methods (e.g. "WhatsApp y a veces Excel"), use the lower-complexity one (higher pain = higher score)

---

### REQ-qual-005: champion scoring rules
**Priority**: MUST

| Signal | Points |
|--------|--------|
| Prospect IS the decision maker (owner, CEO, export director) | 15 |
| Prospect has direct influence but requires approval (manager with budget authority) | 7 |
| Prospect is technical/operational but has no buying power | 3 |
| Prospect is clearly a gatekeeper (secretary, admin) | 0 |

**Acceptance criteria**:
- [ ] Default score is 7 (unknown champion = partial credit, not zero)
- [ ] Score updates to 15 when prospect explicitly identifies as decision maker or owner
- [ ] Score resets to 0 when gatekeeping behavior is detected (e.g. "necesito consultar con mi jefe" + no follow-up autonomy)
- [ ] `cargo` field in `sdr_prospectos` is populated from extracted role information

---

### REQ-qual-006: timeline_decision scoring rules
**Priority**: MUST

| Signal | Points |
|--------|--------|
| Decision before June 2026 or explicit "this quarter" | 10 |
| Decision by end of 2026 | 7 |
| "Someday" or "when budget is approved" (no specific timeline) | 3 |
| No timeline signal | 0 |

**Acceptance criteria**:
- [ ] Default score is 0
- [ ] Score updates when timeline signal is detected in any message
- [ ] If prospect says "antes del Q3" (without specifying year), assume current year (2026)

---

### REQ-qual-007: presupuesto scoring rules
**Priority**: MUST
**Rule**: SDR-G3 (give price range if asked before turn 3, continue discovery)

| Signal | Points |
|--------|--------|
| Budget explicitly available or confirmed ("tenemos presupuesto", "ya está aprobado") | 10 |
| Budget not ruled out, no explicit confirmation | 5 |
| Budget explicitly objected ("no tenemos presupuesto") — but objection handled | 5 |
| Budget explicitly objected and conversation ended | 0 |

**Acceptance criteria**:
- [ ] Default score is 5 (budget unknown = partial credit, not zero)
- [ ] A budget objection that is successfully handled retains 5 points, not 0
- [ ] Score increases to 10 only with explicit positive budget signal
- [ ] If prospect asks price before turn 3, SDR provides range ("desde $X/mes por finca") and continues discovery — does NOT treat the price question as disqualifying

---

### REQ-qual-008: Score threshold actions
**Priority**: MUST
**Rule**: DA-SDR-06

| Score range | Action |
|-------------|--------|
| ≥ 65 | Prepare pilot proposal draft → founder approval gate (DA-SDR-03) |
| 30–64 | Continue discovery |
| < 30 | Graceful exit after turn 10 or when no discovery angle remains |

**Acceptance criteria**:
- [ ] Score reaching ≥ 65 immediately flags `action = 'propose_pilot'` in the next LLM response
- [ ] The pilot proposal draft is generated in the SAME turn that score hits 65 (not deferred)
- [ ] Score < 30 at turn 10 triggers graceful exit message: "Cuando estés listo para digitalizar tu operación de campo, estaremos aquí. ¡Éxito!" — then session closed
- [ ] Score < 30 before turn 10 does NOT trigger exit — discovery continues to look for qualifying signals
- [ ] `sdr_prospectos.status` transitions correctly: 'en_discovery' → 'qualified' (≥65) or 'unqualified' (<30 at limit)

---

### REQ-qual-009: Score is evidence-gated, not LLM-asserted
**Priority**: MUST
**Rule**: R1 (no invented data), SDR-G1 (no invented reference cases/stats)

The LLM MUST NOT increase a score dimension based on inference or assumption. Score deltas MUST be accompanied by an `evidence_quote` — the exact text from the prospect's message that justifies the score. If no qualifying evidence is present in the current message, all score deltas MUST be zero.

**Acceptance criteria**:
- [ ] `RespuestaSDR.score_delta` includes `evidence_quote: string | null` per changed dimension
- [ ] A null `evidence_quote` with a non-zero delta is a validation error — rejected before DB write
- [ ] Test: message "me gusta la idea" produces score_delta with all zeros and null evidence_quotes
- [ ] Test: message "manejamos 45 fincas en Ecuador" produces tamano_cartera delta = 20 with evidence_quote = "manejamos 45 fincas"

---

## Scenarios

### SC-qual-01: Exportadora with high EUDR urgency reaches threshold in 4 turns

**Given**: Prospect is an export company manager. Conversation turns: (1) intro, (2) "manejamos 38 fincas de cacao", (3) "nuestro importador en Alemania nos pidió trazabilidad antes de octubre", (4) "actualmente registramos todo en Excel".

**When**: Each turn is processed and score is updated.

**Then**: After turn 4, score_total ≥ 65.
- eudr_urgency = 25 (importador Alemania + octubre deadline)
- tamano_cartera = 15 (38 fincas → 20-49 range)
- calidad_dato = 12 (Excel)
- champion = 7 (manager, buying power unconfirmed)
- timeline_decision = 10 (before October 2026 = this year)
- presupuesto = 5 (unknown, default)
- Total = 74 → action = 'propose_pilot'

---

### SC-qual-02: Gatekeeper filtered, discovery continues without escalation

**Given**: Prospect says "soy el asistente del gerente de exportaciones, él me pidió investigar opciones".

**When**: SDR processes the message.

**Then**: champion = 0 (gatekeeper). Total score remains <65. SDR continues discovery but adapts: "¿Podría incluirme en una conversación con el gerente para mostrarle cómo funciona?"

---

### SC-qual-03: Budget objection handled correctly

**Given**: Score is 60. Prospect says "no tenemos presupuesto para esto este año".

**When**: SDR detects objection_detected = 'sin_presupuesto'. presupuesto score remains 5 (handled objection).

**Then**: score_total = 60 (not decreased). SDR applies SP-SDR-05 objection response. Discovery continues. Score does NOT drop below threshold.

---

### SC-qual-04: Low-potential prospect exits gracefully at turn 10

**Given**: After 10 turns, score = 22 (individual gerente, no EUDR, no clear timeline, no budget signal).

**When**: Turn 10 is processed and score < 30.

**Then**: action = 'graceful_exit'. Status = 'unqualified'. SDR sends: "Cuando estés listo para digitalizar tu operación de campo, estaremos aquí. ¡Éxito!" No pilot proposed. Conversation closed.
