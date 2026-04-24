# Playbook: Discovery — Gerente de Finca Mediana
> Version: 1.0 | Date: 2026-04-23

---

## Discovery Tree: Gerente de Finca Mediana

Árbol de discovery para dueños y gerentes de finca individual. Máximo 7 preguntas por prospecto.

---

## Perfil del segmento

**Quién es**: Dueño o gerente de una finca de 20-200 ha. Cacao o banano. 5-15 trabajadores. Ecuador (Sucumbíos, Esmeraldas, Los Ríos) o Guatemala. Puede tener un jefe de finca que maneja el día a día, o puede ser él mismo el único gerente.

**Dónde opera**: Finca individual, no exportadora. Vende a una exportadora o cooperativa. En algunos casos, aspira a exportar directamente.

**Pain primario**: Control. No sabe qué pasó exactamente en el campo esta semana sin hablar con el capataz — y el capataz no siempre recuerda o reporta todo.

**Pain secundario**: La exportadora empieza a pedirle registros de prácticas. Certificaciones (Rainforest Alliance, Fairtrade) exigen evidencia documental.

**Presupuesto**: Sensible al precio. Capaz de $50-200/mes si el valor es claro. Ciclo de decisión corto (días, no meses) si confía en el producto.

---

## Árbol de 7 preguntas

### Q-GF-01 — Tamaño de operación (proxy para cartera, max 20 pts)

**Pregunta**: "¿Cuántas hectáreas tiene tu finca aproximadamente?"

**Mapeo de hectáreas a score**:
- 50+ ha → 20 pts (operación grande, complejidad alta)
- 20-49 ha → 15 pts
- 10-19 ha → 10 pts
- 5-9 ha → 5 pts
- < 5 ha → 0 pts (muy pequeño para ROI)

**Follow-up**:
"¿Cuántos trabajadores de campo tienes aproximadamente?"

**Nota**: Si mencionan trabajadores, eso también ayuda a estimar complejidad del seguimiento.

---

### Q-GF-02 — Calidad del dato (max 20 pts)

**Pregunta**: "¿Cómo llevas el registro de lo que hacen los trabajadores en el campo — cuaderno, mensajes de WhatsApp, algo digital?"

**Señales a escuchar**:
- "De palabra, no llevo registro" → 20 pts
- "El capataz lleva un cuaderno" → 18 pts
- "Me mandan WhatsApps de vez en cuando" → 15 pts
- "Llevo una hoja de Excel" → 12 pts
- "Tengo una app agro" → 5 pts

**Follow-up si tienen cuaderno**:
"¿Ese cuaderno lo ves tú regularmente o solo cuando vas a la finca?"

**Follow-up si tienen app**:
"¿La usan los trabajadores o más el jefe de finca?"

---

### Q-GF-03 — EUDR / Presión del comprador (max 25 pts)

**Pregunta**: "¿Tu exportadora o comprador ya te ha pedido demostrar el origen y las prácticas de campo de tu cacao o banano?"

**Señales a escuchar**:
- "Sí, me pidieron registros de aplicación o trazabilidad" → 25 pts (presión activa del comprador)
- "He escuchado que viene, pero aún no me han pedido nada" → 15 pts
- "Vendo a exportadora que exporta a Europa" → 8 pts (contexto, sin presión directa)
- "Vendo localmente, sin exigencia de certificación" → 0 pts

**Follow-up si hay presión activa**:
"¿Te dieron algún plazo o formato específico?"

---

### Q-GF-04 — Champion (max 15 pts)

**Pregunta**: "¿Tú administras directamente la finca o hay un jefe de finca que toma las decisiones del día a día?"

**Nota**: Para gerente_finca, el default de champion es 15 pts si el dueño habla directamente. La pregunta sirve para confirmar o actualizar.

**Señales a escuchar**:
- "Yo mismo administro todo" → 15 pts
- "Tengo un jefe de finca pero yo decido las inversiones" → 15 pts (dueño = champion)
- "Mi jefe de finca maneja todo, yo solo superviso" → 7 pts

---

### Q-GF-05 — Timeline (max 10 pts)

**Pregunta**: "¿Estás en algún proceso de certificación o auditoría que tenga fecha límite?"

**Señales a escuchar**:
- "Sí, auditoría de Rainforest Alliance en 3 meses" → 10 pts
- "Quiero certificarme este año" → 7 pts
- "En algún momento" → 3 pts
- Sin señal → 0 pts

**Follow-up**:
"¿Cuándo comienza tu próxima temporada de cosecha o siembra importante?"

---

### Q-GF-06 — Presupuesto (max 10 pts)

**Pregunta**: "¿Tienes un monto reservado para herramientas o tecnología de campo este año?"

**Nota para gerente_finca**: Esta pregunta es más sensible que con exportadoras. Introducirla con suavidad.

**Señales a escuchar**:
- "Sí, tengo" → 10 pts
- Silencio o evasión → 5 pts (mantener)
- "No tengo plata para eso ahora" → activa OBJ-01, mantiene 5 pts

**REGLA SDR-G3**: Si preguntan precio antes del turno 3, dar rango honesto: "Para fincas de tu tamaño, hablamos de entre $X y $Y por mes. Pero antes de darte un número más exacto, ¿me puedes contar un poco más sobre tu operación?"

---

### Q-GF-07 — Pain refinement

**Pregunta**: "¿Cuál es el problema que más te quita el sueño cuando piensas en la gestión diaria de tu finca?"

**Señales a escuchar**:
- "No sé qué aplican mis trabajadores / si lo hacen bien" → pain de control
- "Pierdo mucho tiempo llamando o yendo a la finca" → pain de eficiencia
- "Mi comprador me pide papeles y no sé qué hacer" → pain de compliance
- "Tengo pérdidas que no sé de dónde vienen" → pain de visibilidad económica

**Este pain alimenta `punto_de_dolor_principal` en el deal brief.**

---

## Frases de transición específicas para gerente_finca

**Cuando confirman cuaderno del capataz**:
"El cuaderno es válido. El problema es que el cuaderno está en el campo cuando tú estás en casa, o se moja, o se pierde. ¿Cuántas veces tienes que llamar al capataz para saber qué pasó esta semana?"

**Cuando confirman WhatsApp informal**:
"Los audios de WhatsApp son una muy buena señal — significa que los trabajadores ya tienen el canal. Wasagro hace que esos audios lleguen organizados, no como mensajes perdidos en el chat."

**Cuando confirman presión del comprador**:
"Exacto — es lo que vemos en muchas fincas en Ecuador ahora mismo. El comprador empieza a pedir registros y la finca no tiene nada estructurado. Wasagro resuelve eso sin que el trabajador tenga que aprender nada nuevo. ..."

**Antes de propuesta** (score ≥ 65):
"Con lo que me contaste — [tamaño], [presión comprador], y datos actualmente en [método] — Wasagro puede darte control total en una semana. Déjame preparar algo específico para tu finca."

---

## Señales de descalificación temprana para gerente_finca

- Finca < 5 ha con 1-2 trabajadores: score máximo alcanzable ≈ 35 (ROI negativo para Wasagro)
- No exporta y comprador local sin exigencias: EUDR = 0, timeline poco urgente
- Ya tiene sistema funcional completo: calidad_dato = 0

Si se detectan ≥ 2 de estos señales en turno 2-3, priorizar Q-GF-07 (pain) para ver si hay algún ángulo útil. Si el pain no es lo suficientemente fuerte, cierre gracioso temprano.
