# Spec: narratives
> Change: sdr-conversacional | Phase: sdd-spec | Date: 2026-04-23

## Overview

Defines Narrative A ("inteligencia operativa de campo") and Narrative B ("cumplimiento EUDR antes del deadline"), their opening messages, value proposition framing, proof points, and A/B assignment rules. Narrative assignment is random per new prospect, stored, and tracked for conversion analytics.

---

## Requirements

### REQ-narr-001: Two distinct narratives with different opening frames
**Priority**: MUST
**Rule**: DA-SDR-05

**Narrative A — Inteligencia Operativa de Campo**
Core frame: "Wasagro convierte los reportes informales de tus trabajadores en datos estructurados que te permiten tomar mejores decisiones."
Emotional trigger: Loss of control. Every day without data = decisions made blind.
Value hook: "¿Qué pasó en el lote 3 la semana pasada? Wasagro te lo dice."

**Narrative B — Cumplimiento EUDR antes del deadline**
Core frame: "El Reglamento de Deforestación de la UE exige trazabilidad documental desde 2025. Wasagro te da la evidencia que tus compradores europeos van a pedir."
Emotional trigger: Fear of contract loss. EUDR is not optional — it's compliance.
Value hook: "Tu importador europeo va a pedirte prueba de due diligence. ¿Tienes los datos?"

**Acceptance criteria**:
- [ ] Every new prospect is assigned narrative A or B at creation time (random 50/50)
- [ ] Assignment is stored in `sdr_prospectos.narrativa_asignada` and never changed mid-conversation
- [ ] The first message the SDR sends uses the narrative's opening frame, not a generic greeting
- [ ] The narrative is injected into the LLM prompt as part of the segment overlay

---

### REQ-narr-002: Narrative A — full opening message template
**Priority**: MUST
**Rule**: SDR-G1 (no invented stats), SDR-G4 (no artificial urgency)

**For exportadora**:
"Hola, soy el asistente de Wasagro. Veo que trabajas con fincas de campo — me comunico porque tenemos algo que podría interesarte. Wasagro convierte los reportes de voz de los trabajadores en datos estructurados al instante, sin apps, solo por WhatsApp. ¿Cuántas fincas manejas en tu cartera?"

**For ONG**:
"Hola, soy el asistente de Wasagro. Wasagro ayuda a programas de asistencia agrícola a capturar datos de campo directamente de los productores por voz — sin formularios, sin apps. ¿Cuántos agricultores tiene tu programa?"

**For gerente_finca**:
"Hola, soy el asistente de Wasagro. Wasagro ayuda a gerentes de finca a tener control total de lo que pasa en el campo sin cambiar la forma de trabajar de los jornaleros. Solo WhatsApp. ¿Cuántas hectáreas tiene tu finca?"

**Rules**:
- First message ALWAYS includes a discovery question (tamano_cartera priority)
- Length: 3 sentences maximum
- No exclamation points or excessive enthusiasm
- "Asistente de Wasagro" — not a human name

**Acceptance criteria**:
- [ ] Opening message for Narrative A varies by segment (3 versions)
- [ ] Opening message ends with Q-{SEGMENT}-01 (portfolio/farm size question)
- [ ] Character count ≤ 250 per opening message

---

### REQ-narr-003: Narrative B — full opening message template
**Priority**: MUST
**Rule**: SDR-G4 (no artificial urgency — EUDR is real, not manufactured)

**For exportadora**:
"Hola, soy el asistente de Wasagro. El Reglamento de Deforestación de la UE ya está en vigor para exportaciones de cacao y banano. ¿Tu operación tiene trazabilidad documental lista para los compradores europeos que la empiecen a pedir? Wasagro resuelve eso con datos de voz desde el campo. ¿Cuántas fincas manejas?"

**For ONG**:
"Hola, soy el asistente de Wasagro. Cada vez más donantes y certificadoras exigen datos estructurados de campo para validar el impacto de programas agrícolas. Wasagro captura esos datos por WhatsApp de voz. ¿Cuántos productores tiene tu programa?"

**For gerente_finca**:
"Hola, soy el asistente de Wasagro. Tu exportadora o comprador va a empezar a pedirte documentar el origen y las prácticas de campo — el EUDR europeo ya exige eso. Wasagro te da esa trazabilidad con reportes de voz de tus trabajadores. ¿Tu comprador ya te ha pedido algo así?"

**Rules**:
- EUDR framing must be accurate — do not invent timelines or fines not confirmed
- The threat must be real: importers ARE asking for EUDR proof
- For gerente_finca: the EUDR question also doubles as discovery (Q-GF-03)

**Acceptance criteria**:
- [ ] Opening message for Narrative B varies by segment (3 versions)
- [ ] Narrative B opening for gerente_finca uses Q-GF-03 (EUDR pressure from buyer) as the pivot
- [ ] Character count ≤ 300 per opening message
- [ ] No invented deadlines or fine amounts — stick to "ya está en vigor" (true) not "en X semanas te multan" (not confirmed)

---

### REQ-narr-004: Narrative consistency throughout conversation
**Priority**: MUST

Once a narrative is assigned, all subsequent LLM responses MUST maintain consistency with that narrative's framing. Narrative A conversations frame value as "operational intelligence and control". Narrative B conversations frame value as "compliance and contract protection".

**Consistency rules**:
- Narrative A: proof points emphasize real-time data, decision speed, field control
- Narrative B: proof points emphasize EUDR documentation, buyer requirements, audit trail
- Neither narrative contradicts the other (both are true — they are different entry points to the same product value)

**Acceptance criteria**:
- [ ] The narrative identifier is injected into every LLM call as a parameter
- [ ] The segment overlay (SP-SDR-02/03/04) contains narrative-specific phrasing for each value prop
- [ ] A Narrative A conversation NEVER mentions EUDR urgency as a primary concern (unless the prospect brings it up first)
- [ ] A Narrative B conversation NEVER leads with "control operativo" as the primary hook

---

### REQ-narr-005: A/B tracking in LangFuse
**Priority**: MUST
**Rule**: DA-SDR-05 (track conversion by narrative)

Every SDR LangFuse trace MUST include the narrative assignment as metadata. The following events track A/B performance:

| Event | Metadata |
|-------|----------|
| `sdr_session_started` | `{narrativa, segmento_icp}` |
| `sdr_qualified` | `{narrativa, segmento_icp, score_total, turns_to_qualify}` |
| `sdr_pilot_proposed` | `{narrativa, segmento_icp}` |
| `sdr_meeting_scheduled` | `{narrativa, segmento_icp}` |
| `sdr_unqualified` | `{narrativa, segmento_icp, score_total, exit_reason}` |

**Acceptance criteria**:
- [ ] All 5 events fire at the correct moment with the correct metadata
- [ ] `narrativa` field is always 'A' or 'B' — never null
- [ ] LangFuse dashboard can filter traces by `narrativa` to compare conversion funnels

---

## Scenarios

### SC-narr-01: Narrative A assigned — operational framing throughout

**Given**: New exportadora prospect. Random assignment: Narrative A.

**When**: SDR processes first message.

**Then**: Opening uses Narrative A exportadora template. All subsequent responses frame value as "control operativo y datos de campo en tiempo real". EUDR is NOT mentioned unless the prospect brings it up.

---

### SC-narr-02: Narrative B prospect brings up objection — EUDR framing holds

**Given**: Narrative B. Prospect says "¿por qué necesito esto si ya llevo libreta?".

**When**: SDR detects partial objection (existing system). `ya_tenemos` not fully triggered (libreta is not a "system").

**Then**: Response reframes using Narrative B: "La libreta captura el evento. Lo que tus compradores europeos van a pedir es evidencia digital con fecha, lote y operación. ¿Tu comprador actual ha mencionado algo sobre trazabilidad EUDR?"

---

### SC-narr-03: Cross-narrative pollination blocked

**Given**: Narrative A conversation in turn 4. SDR generates response.

**When**: LLM is called with `narrativa: 'A'` in prompt.

**Then**: Response MUST NOT include: "cumplimiento EUDR", "deadline regulatorio", "multa", or "importador europeo" as primary hooks. These phrases are blocked in Narrative A unless the prospect introduced them first.

---

### SC-narr-04: LangFuse A/B event fires at qualification

**Given**: Narrative B, exportadora, score reaches 68 in turn 5.

**When**: Score crosses 65 threshold.

**Then**: LangFuse event `sdr_qualified` fires with `{narrativa: 'B', segmento_icp: 'exportadora', score_total: 68, turns_to_qualify: 5}`. This populates the A/B conversion dashboard.
