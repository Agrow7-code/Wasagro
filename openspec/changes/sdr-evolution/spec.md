# Especificaciones: Evolución SDR 2026

## 1. Saludo Contextual Inteligente (CTWA)
**Requerimientos:**
- REQ-CTWA-01: `NormalizedMessage` debe incluir un campo opcional `source_context` que contenga el referral data de WhatsApp.
- REQ-CTWA-02: Al crear un nuevo `SDRProspecto`, si `source_context` existe, debe guardarse en el prospecto e inyectarse en el primer mensaje hacia el LLM.

**Escenarios:**
- *Scenario 1*: Usuario llega desde un anuncio de "Control de Plagas". El SDR inicia con "Hola, veo que te interesó nuestra solución de control de plagas..."
- *Scenario 2*: Usuario llega orgánicamente (sin CTWA). El SDR usa el saludo genérico (como funciona actualmente).

## 2. Descomposición Entrelazada (Plan-Act-Reflect)
**Requerimientos:**
- REQ-PAR-01: Modificar `RespuestaSDRSchema` para que devuelva un objeto estructurado: `{ reflection: string, plan: string, action: enum, ... }`.
- REQ-PAR-02: El system prompt debe instruir al LLM a razonar sobre lo que falta (reflection), planear la siguiente pregunta (plan), y luego responder (action).

**Escenarios:**
- *Scenario 1*: El usuario responde su hectárea. El LLM reflexiona "Ya tengo hectáreas, falta cultivo", planea "Preguntar por el cultivo principal", y envía el action "Genial, ¿y qué cultivo tienes?".

## 3. Guardarraíles Deterministas de Precios
**Requerimientos:**
- REQ-PRIC-01: Añadir `request_pricing` al enum de `action` en `RespuestaSDRSchema`.
- REQ-PRIC-02: Cuando `handleSDRSession` recibe `request_pricing`, no emite la respuesta del LLM directamente; en su lugar, el backend calcula el precio en base al `segmento_icp` y `score` y envía un mensaje estandarizado.

**Escenarios:**
- *Scenario 1*: Prospecto pregunta "¿Cuánto cuesta?". LLM emite `action: request_pricing`. El código backend envía: "Nuestros planes empiezan desde $X USD / mes...".

## 4. Smart Handoff
**Requerimientos:**
- REQ-HAND-01: Mejorar la interfaz de `DealBrief` para incluir todos los campos recopilados sin pérdida de información (tamaño, problema, ICP, scores).
- REQ-HAND-02: Cuando se dispara el handoff (ej. `propose_pilot` o `human_request`), el `buildFounderNotification` debe ser consumible tanto por el founder como por sistemas de CRM.

**Escenarios:**
- *Scenario 1*: El prospecto dice "Quiero hablar con un humano". El SDR hace Handoff, y el resumen enviado contiene: Score 80/100, Finca 500ha, Problema: Plagas. 

## 5. Secuencias de Persecución (Chaser Sequences)
**Requerimientos:**
- REQ-CHASE-01: Cada vez que el prospecto habla o se le envía mensaje, encolar un trabajo `sdr_chaser_sequence_1` en pgBoss para ejecutarse en 20 horas, enviando el payload `{ prospecto_id, expected_turn }`.
- REQ-CHASE-02: El worker de pgBoss, al procesar el job, debe verificar que `prospecto.turns_total === expected_turn`. Si no coincide, el job se aborta.

**Escenarios:**
- *Scenario 1*: Se encola chaser en turno 3. El prospecto no responde. Pasan 20 horas. El worker despierta, ve que sigue en turno 3, y envía: "¿Pudiste revisar la información de Wasagro?".
- *Scenario 2*: Se encola chaser en turno 3. El prospecto responde a la hora 2. Turno avanza a 4. Pasan 20 horas, el worker despierta, ve turno 4 != expected_turn (3), aborta en silencio.