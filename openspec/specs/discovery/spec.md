# Spec: discovery
> Change: sdr-conversacional | Phase: sdd-spec | Date: 2026-04-23

## Overview

Defines the discovery question trees per ICP segment (exportadora, ONG, gerente_finca). Discovery questions are ordered by scoring impact — the system always asks the highest-value unanswered question first. Maximum 7 questions per prospect lifetime across all sessions.

---

## Requirements

### REQ-disc-001: Question priority order by scoring dimension
**Priority**: MUST
**Rule**: DA-SDR-04 (max 7 questions total)

Questions are ordered by maximum possible score delta. The SDR MUST ask questions in this order (highest impact first), skipping any already answered:

| Priority | Dimension | Max delta | Example question |
|----------|-----------|-----------|-----------------|
| 1 | tamano_cartera | 20 | "¿Cuántas fincas o productores manejas en tu cartera?" |
| 2 | eudr_urgency | 25 | "¿Recibes presión de tus compradores europeos para demostrar trazabilidad?" |
| 3 | calidad_dato | 20 | "¿Cómo registran hoy los eventos de campo — cuaderno, WhatsApp, app?" |
| 4 | champion | 15 | "¿Tú tomarías la decisión de implementar algo así, o hay otros involucrados?" |
| 5 | timeline_decision | 10 | "¿Cuándo necesitarías tener algo funcionando?" |
| 6 | presupuesto | 10 | "¿Tienes un presupuesto reservado para herramientas de campo este año?" |
| 7 | segmento_confirmacion | — | Confirm ICP segment and apply segment overlay |

**Acceptance criteria**:
- [ ] Questions are selected dynamically based on which dimensions have score = 0 (unanswered)
- [ ] A dimension with score > 0 is skipped — it has already been answered
- [ ] The SDR NEVER asks question N if question N is in `preguntas_realizadas`
- [ ] After 7 questions, no more discovery questions are asked — SDR either proposes or exits based on score

---

### REQ-disc-002: Questions are woven into conversation, not interrogated
**Priority**: MUST
**Rule**: DA-SDR-04

Discovery questions MUST be embedded naturally into a sentence that acknowledges what the prospect just said. The format is: [brief acknowledgment of last message] + [transition] + [question].

Example (bad): "¿Cuántas fincas tienes?" — robotic interrogation
Example (good): "Interesante que menciones la trazabilidad — para entender mejor tu operación, ¿cuántas fincas manejas en total?" — natural flow

**Acceptance criteria**:
- [ ] The pivot question is always the LAST sentence of the response
- [ ] The pivot question is preceded by at least one acknowledgment or reframe sentence
- [ ] Responses with ONLY a question (no preamble) are rejected by the validation layer

---

### REQ-disc-003: Segment detection gates the segment-specific overlay
**Priority**: MUST

The SDR MUST detect the prospect's ICP segment in the first 3 turns. Once detected, the segment-specific system prompt overlay (SP-SDR-02, SP-SDR-03, or SP-SDR-04) is activated for all subsequent turns.

**Detection signals**:
- `exportadora`: mentions "exportadora", "cartera de fincas", "compradores en Europa/USA", "certificación"
- `ong`: mentions "programa", "proyecto", "beneficiarios", "agricultores que asistimos", "grant", "GIZ", "IDB", "USAID"
- `gerente_finca`: mentions "mi finca", "mis trabajadores", "hectáreas", "cultivo propio", without exportadora language

**Default segment**: If not detected by turn 3, default to `gerente_finca` discovery questions (least specialized, most general).

**Acceptance criteria**:
- [ ] `sdr_prospectos.segmento_icp` is updated the moment segment is detected
- [ ] Segment update triggers overlay switch in next LLM call
- [ ] If segment changes mid-conversation (e.g. first thought gerente, actually exportadora), the overlay switches and `segmento_icp` updates in DB

---

### REQ-disc-004: Exportadora discovery tree
**Priority**: MUST

Segment: exportadora. Questions cover: portfolio size, EUDR pressure, current data system, decision authority, timeline to Q4 2025 EUDR deadline.

**7-question tree for exportadora**:

1. **Q-EX-01** (tamano_cartera): "¿Cuántas fincas proveedoras tienes en tu cartera actualmente?"
2. **Q-EX-02** (eudr_urgency): "¿Tus compradores europeos te están pidiendo evidencia de trazabilidad o cumplimiento EUDR para las próximas temporadas?"
3. **Q-EX-03** (calidad_dato): "¿Cómo registran hoy los eventos de campo en esas fincas — cuaderno, app, WhatsApp, algo más?"
4. **Q-EX-04** (champion): "¿Tú liderarías la decisión de implementar una herramienta como esta, o habría que involucrar a otros directivos?"
5. **Q-EX-05** (timeline): "¿Tienes algún plazo para tener trazabilidad documentada — por ejemplo, antes de una auditoría o de una nueva temporada?"
6. **Q-EX-06** (presupuesto): "¿Existe algún presupuesto asignado para herramientas de trazabilidad o tecnología de campo este año?"
7. **Q-EX-07** (pain refinement): "¿Cuál es el dolor más grande que tienes hoy con la forma en que llegan los datos desde las fincas?"

**Pain framing for exportadora**: EUDR compliance + contract retention with European buyers.

---

### REQ-disc-005: ONG discovery tree
**Priority**: MUST

Segment: ong / programa de asistencia. Questions cover: program size, current monitoring tools, grant cycle, M&E requirements, technology adoption among beneficiaries.

**7-question tree for ONG**:

1. **Q-ONG-01** (tamano_cartera): "¿Cuántos agricultores o productores tiene actualmente el programa que manejas?"
2. **Q-ONG-02** (calidad_dato): "¿Cómo registra el equipo técnico los eventos de campo — formularios, apps, WhatsApp?"
3. **Q-ONG-03** (presupuesto): "¿El programa tiene una línea de herramientas digitales o tecnología de campo dentro del presupuesto del grant?"
4. **Q-ONG-04** (eudr_urgency): "¿Alguno de tus donantes o financiadores pide métricas de trazabilidad o cumplimiento de estándares internacionales como EUDR o Rainforest Alliance?"
5. **Q-ONG-05** (timeline): "¿Tienes algún entregable de M&E o informe de impacto que requiera datos de campo estructurados próximamente?"
6. **Q-ONG-06** (champion): "¿Eres tú quien aprueba la adopción de nuevas herramientas en el programa, o depende de un comité?"
7. **Q-ONG-07** (pain refinement): "¿Qué tan difícil es hoy demostrar el impacto del programa con datos reales de campo?"

**Pain framing for ONG**: M&E compliance, donor reporting, and proof-of-impact with data.

---

### REQ-disc-006: Gerente de finca mediana discovery tree
**Priority**: MUST

Segment: gerente_finca. Questions cover: hectares, workers, current data capture, export relationship (do they sell through exportadora), technology comfort.

**7-question tree for gerente_finca**:

1. **Q-GF-01** (tamano_cartera): "¿Cuántas hectáreas tiene tu finca aproximadamente?"
2. **Q-GF-02** (calidad_dato): "¿Cómo llevas el registro de lo que hacen los trabajadores en el campo — cuaderno, mensajes de WhatsApp, algo digital?"
3. **Q-GF-03** (eudr_urgency): "¿Tu exportadora o comprador te ha pedido demostrar el origen y las prácticas de tu cacao o banano?"
4. **Q-GF-04** (champion): "¿Tú administras directamente la finca o hay un jefe de finca que maneja el día a día?"
5. **Q-GF-05** (timeline): "¿Estás en algún proceso de certificación o auditoría que tenga fecha límite?"
6. **Q-GF-06** (presupuesto): "¿Tienes un monto reservado para herramientas o tecnología de campo este año?"
7. **Q-GF-07** (pain refinement): "¿Cuál es el problema que más te quita el sueño cuando piensas en la gestión de tu finca?"

**Pain framing for gerente_finca**: Control directo, no perder datos de campo, cumplir requisitos de la exportadora.

---

## Scenarios

### SC-disc-01: Segment detected in turn 1, overlay activated for turn 2

**Given**: First message: "Hola, soy gerente de operaciones en Exportadora Ecuacacao, manejamos fincas de cacao en Sucumbíos."

**When**: SDR processes message.

**Then**: segmento_icp = 'exportadora'. SP-SDR-02 overlay activated. Q-EX-01 asked in the response (cuántas fincas).

---

### SC-disc-02: Question skip when dimension already scored

**Given**: Prospect already said "tenemos 42 fincas" in turn 2. preguntas_realizadas includes Q-EX-01 answered with score_delta tamano_cartera = 15.

**When**: SDR selects next question.

**Then**: Q-EX-01 is SKIPPED. Next question is Q-EX-02 (eudr_urgency — highest impact unanswered).

---

### SC-disc-03: Question 7 reached, still under threshold

**Given**: After 7 questions, score_total = 55 (just under 65).

**When**: Turn 8 arrives (post-question 7).

**Then**: No new discovery questions. SDR moves to a "soft close" attempt: "Creo que Wasagro puede ser útil para tu operación. ¿Le darías una oportunidad a una demo de 20 minutos para que lo veas en acción?" — This is counted as a meeting request, not a discovery question.

---

### SC-disc-04: Segment changes mid-conversation

**Given**: Initially classified as gerente_finca. In turn 4, prospect says "de hecho, manejamos la comercialización de unas 25 fincas vecinas también".

**When**: SDR detects exportadora signal.

**Then**: segmento_icp updated to 'exportadora'. SP-SDR-02 overlay replaces SP-SDR-04 for the next turn. Remaining discovery questions shift to exportadora tree (skipping already-answered dimensions).
