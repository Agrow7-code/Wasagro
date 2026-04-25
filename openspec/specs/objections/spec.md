# Spec: objections
> Change: sdr-conversacional | Phase: sdd-spec | Date: 2026-04-23

## Overview

Defines the 10 objection patterns the SDR must detect and handle. Each objection has a detection pattern (keywords + context), a response structure (acknowledge + reframe + evidence + pivot), and a scoring impact. Objection handling does NOT guarantee conversion — it maintains the conversation, updates the score appropriately, and resumes discovery.

---

## Guardrails

- **SDR-G1**: No invented reference cases. Evidence must come from generic domain knowledge, not fabricated Wasagro customer stories.
- **SDR-G4**: No artificial urgency. "If you don't sign up by Friday..." is prohibited.
- **SDR-G6**: No competitor attacks by name. Acknowledge the competitor exists, differentiate on facts.

---

## Requirements

### REQ-obj-001: Objection detection before LLM routing
**Priority**: MUST

The pipeline MUST perform keyword-based pre-detection of objections before sending the message to the LLM. If an objection is detected, the `objection_detected` field is set in `EntradaSDR` so the LLM knows to activate the SP-SDR-05 overlay. Detection is additive to, not replacing, the main SP-SDR-01 prompt.

**Objection keyword map** (for pre-detection — LLM refines via context):

| Objection ID | Keywords / Phrases |
|-------------|-------------------|
| `sin_presupuesto` | presupuesto, no tenemos, no hay plata, caro, costoso, no podemos pagar |
| `no_tiempo` | no tenemos tiempo, estamos muy ocupados, ahora no |
| `ya_tenemos` | ya tenemos sistema, ya usamos, tenemos ERP, tenemos app |
| `mis_trabajadores_no` | mis trabajadores no saben, no tienen celular, son mayores |
| `datos_propios` | mis datos son míos, quién accede, privacidad, confidencial |
| `no_confio_ia` | IA, inteligencia artificial, no me fío, errores |
| `muy_complicado` | complicado, difícil, no entenderían, capacitación |
| `necesito_pensarlo` | déjame pensar, lo consulto, te aviso, después |
| `ya_lo_intente` | ya intenté, probamos, no funcionó, fallamos |
| `competidor_mencionado` | [competitor names], ya los veo, ya tenemos una oferta |

**Acceptance criteria**:
- [ ] Pre-detection runs regex/keyword match on the incoming message before LLM call
- [ ] At most ONE objection is flagged per turn (the most specific match wins)
- [ ] If no objection is detected, `objection_detected = null` — SP-SDR-05 overlay is NOT activated
- [ ] The detected objection ID is stored in `sdr_interacciones.objection_detected`

---

### REQ-obj-002: Response structure for each objection
**Priority**: MUST

Every objection response MUST follow this four-part structure:
1. **Acknowledge**: Validate the concern — show you heard it, don't argue
2. **Reframe**: Shift the frame from cost/risk to value/risk of NOT acting
3. **Evidence**: One concrete, believable proof point (no invented stats — use domain facts)
4. **Pivot**: Ask one discovery question to advance the conversation

**Acceptance criteria**:
- [ ] LLM output for any message with `objection_detected != null` MUST contain all 4 structural elements
- [ ] The pivot question MUST NOT be a question already recorded in `preguntas_realizadas`
- [ ] Response length MUST be ≤ 4 sentences (WhatsApp readability)
- [ ] No markdown formatting (no **, no bullet lists) in the WhatsApp message

---

### REQ-obj-003: The 10 objections with response templates
**Priority**: MUST
**Rule**: SDR-G1 (no invented stats)

#### OBJ-01: sin_presupuesto

**Detection**: "no tenemos presupuesto", "es muy caro", "no podemos costear"
**Acknowledge**: "Entiendo, el presupuesto siempre es un tema."
**Reframe**: "La mayoría de los equipos que trabajan con nosotros empezaron con un piloto gratuito de validación antes de comprometer cualquier cifra."
**Evidence**: "El costo de no tener trazabilidad cuando el importador europeo te exige EUDR proof es perder el contrato — eso sí tiene precio."
**Pivot**: "¿Cuántas fincas manejas en tu cartera hoy?"
**Score impact**: presupuesto stays at 5 (objection handled, not resolved)

#### OBJ-02: no_tiempo

**Detection**: "estamos muy ocupados", "ahora no es buen momento", "no tenemos tiempo"
**Acknowledge**: "Entiendo — la temporada de cosecha no es momento para agregar carga de trabajo."
**Reframe**: "Wasagro está diseñado para que los trabajadores de campo reporten en 30 segundos por voz — sin capacitación, sin pantallas complicadas."
**Evidence**: "La implementación inicial tarda menos de una semana para las primeras fincas."
**Pivot**: "¿En qué época del año tendrías más espacio para una prueba piloto?"
**Score impact**: timeline_decision updates if they give a specific period

#### OBJ-03: ya_tenemos

**Detection**: "ya tenemos sistema", "usamos SAP", "tenemos una app"
**Acknowledge**: "Qué bien que ya tienen algo — eso significa que entienden el valor de los datos de campo."
**Reframe**: "La pregunta es si ese sistema llega hasta el trabajador en el lote, o se queda en la oficina."
**Evidence**: "La mayoría de ERPs capturan lo que sucede en oficina. Wasagro captura lo que sucede en el lote, en tiempo real, por voz."
**Pivot**: "¿Cómo reportan los trabajadores de campo hoy — van a la oficina, o envían WhatsApp?"
**Score impact**: calidad_dato updated based on their system description

#### OBJ-04: mis_trabajadores_no

**Detection**: "mis trabajadores no saben usar apps", "no tienen smartphone", "son mayores", "no hablan bien español"
**Acknowledge**: "Es una preocupación muy válida — la mayoría de plataformas de campo fallan exactamente ahí."
**Reframe**: "Wasagro funciona por WhatsApp de voz. Si el trabajador puede mandar un audio por WhatsApp, puede reportar. No hay app que descargar, no hay pantallas complicadas."
**Evidence**: "WhatsApp ya tiene una penetración de 90%+ en zonas rurales de Ecuador y Guatemala."
**Pivot**: "¿Tus trabajadores ya usan WhatsApp para comunicarse con la finca?"
**Score impact**: calidad_dato = 18-20 (workers not reporting = maximum pain)

#### OBJ-05: datos_propios

**Detection**: "mis datos son míos", "quién ve mis datos", "privacidad", "confidencial", "no quiero compartir"
**Acknowledge**: "Es la pregunta correcta — los datos de tu finca son tuyos y nadie debería acceder sin tu permiso."
**Reframe**: "En Wasagro, los datos de cada finca son accesibles solo por esa finca. No los compartimos con exportadoras ni terceros sin tu autorización explícita."
**Evidence**: "Cada finca tiene su propio espacio aislado en la base de datos con control de acceso por usuario."
**Pivot**: "¿Hay algún tipo de dato de campo que sea especialmente sensible en tu operación?"
**Score impact**: No score change (trust concern, not disqualifier)

#### OBJ-06: no_confio_ia

**Detection**: "IA", "inteligencia artificial", "los robots se equivocan", "no me fío", "errores"
**Acknowledge**: "Totalmente de acuerdo en ser escéptico — hay muchas soluciones de IA que prometen demasiado."
**Reframe**: "Wasagro no toma decisiones por ti. Te ayuda a que la información que ya tienes — la que viven tus trabajadores en el campo — llegue estructurada a tus manos. Tú decides qué hacer con ella."
**Evidence**: "El trabajador habla, el sistema transcribe y organiza. Si el dato no es claro, el sistema pregunta — no inventa."
**Pivot**: "¿Qué tipo de datos de campo son los que más se pierden hoy en tu operación?"
**Score impact**: No score change (concerns are handled, not disqualifying)

#### OBJ-07: muy_complicado

**Detection**: "complicado", "difícil de implementar", "capacitación", "no lo entenderían"
**Acknowledge**: "La implementación es siempre la parte más temida — con razón."
**Reframe**: "El flujo del trabajador es: abrir WhatsApp → grabar audio de 15 segundos → enviar. Nada más."
**Evidence**: "No hay app que instalar, no hay login, no hay formulario. WhatsApp ya lo saben usar."
**Pivot**: "¿Cuántos trabajadores de campo tienes aproximadamente?"
**Score impact**: tamano_cartera updated if they reveal worker count as proxy

#### OBJ-08: necesito_pensarlo

**Detection**: "lo consulto", "déjame pensar", "te aviso", "después te confirmo"
**Acknowledge**: "Por supuesto — es una decisión que vale la pena considerar bien."
**Reframe**: "Para facilitar esa conversación, ¿te vendría bien que le mostremos cómo funciona en 20 minutos con datos de tu propia finca?"
**Evidence**: (none needed — this is a soft close)
**Pivot**: "¿Con quién más en tu equipo hablarías antes de decidir?"
**Score impact**: champion updates if they reveal the decision maker

#### OBJ-09: ya_lo_intente

**Detection**: "ya probamos algo así", "intentamos digitalizar", "no funcionó", "fallamos con otra plataforma"
**Acknowledge**: "Eso duele — invertir tiempo en implementar algo y que no funcione es frustrante."
**Reframe**: "La mayoría de implementaciones fallan porque la plataforma requiere que el trabajador cambie su forma de trabajar. Wasagro se adapta a lo que ya hacen: WhatsApp."
**Evidence**: "La diferencia clave es el canal. No pedimos adopción de nueva app — usamos el canal que ya tienen."
**Pivot**: "¿En qué parte específica falló el intento anterior — la tecnología, la adopción de los trabajadores, o el soporte?"
**Score impact**: calidad_dato = max (they tried and failed = maximum pain signal)

#### OBJ-10: competidor_mencionado

**Detection**: any competitor name or "ya tenemos una oferta de otra empresa"
**Acknowledge**: "Hay varias opciones en el mercado — bien que estés evaluando."
**Reframe**: "Lo que diferencia a Wasagro es que opera 100% por WhatsApp de voz — no requiere app nueva, no requiere que el trabajador sepa escribir, y llega hasta el lote más remoto."
**Evidence**: (generic: WhatsApp penetration, voice-first, no-app)
**Pivot**: "¿Qué es lo que más valoras en la solución que estás evaluando?"
**Score impact**: No change (competitive objection handled, continue discovery)
**Rule**: SDR-G6 — never attack the competitor by name. Never claim Wasagro is better in general. Differentiate specifically on WhatsApp-native + voice-first.

**Acceptance criteria** (applies to all 10):
- [ ] Each objection response respects the 4-part structure (Acknowledge, Reframe, Evidence, Pivot)
- [ ] No response mentions a competitor by name
- [ ] No response invents customer statistics ("el 80% de nuestros clientes..." is NOT allowed unless real)
- [ ] Each pivot question is a valid discovery question mapped to a scoring dimension
- [ ] `sdr_interacciones.objeciones_manejadas` is updated with the objection ID after handling

---

## Scenarios

### SC-obj-01: Budget objection with score near threshold

**Given**: score_total = 60. Prospect says "no tenemos presupuesto ahora mismo".

**When**: Pipeline detects `sin_presupuesto`. LLM activated with SP-SDR-05 overlay.

**Then**: presupuesto stays at 5 (not reduced). Response uses OBJ-01 template. score_total remains 60. Discovery pivot asks about portfolio size to potentially push over 65.

---

### SC-obj-02: Previous-failure objection reveals maximum pain

**Given**: score_total = 35. Prospect says "ya probamos con una app agrícola hace dos años y los trabajadores no la usaron".

**When**: Pipeline detects `ya_lo_intente`. LLM processes with SP-SDR-05 overlay.

**Then**: calidad_dato = 20 (max — previous failed digitalization attempt = high pain). score_total increases. Response uses OBJ-09 template. Discovery continues toward threshold.

---

### SC-obj-03: Competitor mention does not interrupt discovery flow

**Given**: Prospect says "ya estamos hablando con otra empresa para lo mismo".

**When**: Pipeline detects `competidor_mencionado`.

**Then**: No score change. Response uses OBJ-10 template without naming the competitor. Pivot focuses on what they value most in the evaluation — this is a qualification question (champion dimension: are they the decision maker in this eval?).

---

### SC-obj-04: Trust objection clears, discovery resumes

**Given**: Prospect says "¿y quién puede ver mis datos de mis fincas?".

**When**: Pipeline detects `datos_propios`.

**Then**: Response uses OBJ-05 template. No score change. Conversation continues naturally. The objection is logged in `objeciones_manejadas`. Discovery pivot moves to pain point discovery.
