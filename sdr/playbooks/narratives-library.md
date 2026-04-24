# Playbook: Narratives Library
> Version: 1.0 | Date: 2026-04-23

---

## Wasagro SDR — Biblioteca de Narrativas

Contiene los opening messages completos, proof points por narrativa, y frases de transición. Usar junto con SP-SDR-01 y el overlay de segmento activo.

---

## Narrativa A: Inteligencia Operativa de Campo

**Core frame**: Wasagro convierte los reportes informales de tus trabajadores en datos estructurados que te permiten tomar mejores decisiones.

**Emotional trigger**: Pérdida de control. Cada día sin datos = decisiones a ciegas.

**Value hook**: "¿Sabes exactamente qué pasó en el lote 3 la semana pasada? Wasagro te lo dice."

---

### Opening messages — Narrativa A

**Exportadora**:
"Hola, soy el asistente de Wasagro. Veo que trabajas con fincas de campo — me comunico porque tenemos algo que podría interesarte. Wasagro convierte los reportes de voz de los trabajadores en datos estructurados al instante, sin apps, solo por WhatsApp. ¿Cuántas fincas manejas en tu cartera?"

**ONG**:
"Hola, soy el asistente de Wasagro. Wasagro ayuda a programas de asistencia agrícola a capturar datos de campo directamente de los productores por voz — sin formularios, sin apps. ¿Cuántos agricultores tiene tu programa?"

**Gerente finca**:
"Hola, soy el asistente de Wasagro. Wasagro ayuda a gerentes de finca a tener control total de lo que pasa en el campo sin cambiar la forma de trabajar de los jornaleros. Solo WhatsApp. ¿Cuántas hectáreas tiene tu finca?"

---

### Proof points — Narrativa A

Usar solo estos — no inventar otros:

1. **Voz a estructura**: "El trabajador graba 20 segundos de audio. Wasagro lo transcribe, identifica el tipo de evento, el lote, y lo guarda estructurado. Sin formularios."

2. **Sin app nueva**: "No hay app que descargar. Funciona en el WhatsApp que el trabajador ya tiene."

3. **Reporte semanal automático**: "Cada lunes, el jefe de finca recibe un resumen de todo lo que pasó en la semana anterior — sin pedirlo."

4. **Sin capacitación de campo**: "El cambio para el trabajador es: en lugar de decirle al capataz, le manda un audio a Wasagro. Nada más."

5. **Aislamiento de datos**: "Los datos de tu finca son solo tuyos. Nadie los ve sin tu permiso."

---

### Frases de transición — Narrativa A

- "Para entender mejor cómo Wasagro puede ayudarte específicamente, ..."
- "Basándome en lo que me dices, parece que el mayor desafío es [el dolor mencionado]. Wasagro resuelve exactamente eso. ..."
- "Muchas operaciones como la tuya empezaron con el mismo problema. ..."
- "Lo que más valoran los que ya lo usan es que no tuvieron que cambiar nada del proceso de campo. ..."

---

## Narrativa B: Cumplimiento EUDR antes del Deadline

**Core frame**: El Reglamento de Deforestación de la UE exige trazabilidad documental. Wasagro te da la evidencia que tus compradores europeos van a pedir.

**Emotional trigger**: Miedo a perder contratos. El EUDR no es opcional — es compliance.

**Value hook**: "Tu importador europeo va a pedirte prueba de due diligence. ¿Tienes los datos?"

---

### Opening messages — Narrativa B

**Exportadora**:
"Hola, soy el asistente de Wasagro. El Reglamento de Deforestación de la UE ya está en vigor para exportaciones de cacao y banano. ¿Tu operación tiene trazabilidad documental lista para los compradores europeos que la empiecen a pedir? Wasagro resuelve eso con datos de voz desde el campo. ¿Cuántas fincas manejas?"

**ONG**:
"Hola, soy el asistente de Wasagro. Cada vez más donantes y certificadoras exigen datos estructurados de campo para validar el impacto de programas agrícolas. Wasagro captura esos datos por WhatsApp de voz. ¿Cuántos productores tiene tu programa?"

**Gerente finca**:
"Hola, soy el asistente de Wasagro. Tu exportadora o comprador va a empezar a pedirte documentar el origen y las prácticas de campo — el EUDR europeo ya exige eso. Wasagro te da esa trazabilidad con reportes de voz de tus trabajadores. ¿Tu comprador ya te ha pedido algo así?"

---

### Proof points — Narrativa B

1. **EUDR compliance**: "El EUDR exige que los operadores del mercado europeo demuestren due diligence sobre el origen de cacao, café y otros commodities. Eso incluye evidencia de prácticas de campo."

2. **Trail documental**: "Wasagro genera un historial de cada evento de campo: qué se aplicó, en qué lote, cuándo, quién. Es la evidencia que el importador europeo va a pedir."

3. **Trazabilidad por finca**: "Cada finca proveedora tiene su propio registro. Cuando el comprador europeo pida el informe de due diligence, tienes los datos organizados por finca."

4. **Sin cambio en el campo**: "El trabajador no sabe que está generando evidencia EUDR. Solo manda un audio al WhatsApp de su finca. Wasagro hace el resto."

5. **Velocidad de implementación**: "En una semana de piloto, ya tienes las primeras fincas generando evidencia documentada."

---

### Frases de transición — Narrativa B

- "El mercado europeo está evolucionando rápido en este tema — y los compradores que ya preguntan son los más progresistas. ..."
- "Lo que muchos exportadores descubren cuando les llega el pedido de EUDR proof es que no tienen los datos estructurados necesarios. ..."
- "La diferencia entre tener que apresurarte y estar listo de antemano es exactamente lo que Wasagro resuelve. ..."
- "Tu importador va a hacer la pregunta — la cuestión es si tienes la respuesta lista. ..."

---

## Reglas de consistencia narrativa

| Narrativa | SÍ usar | NO usar como hook primario |
|-----------|---------|---------------------------|
| A | "datos de campo", "control", "visibilidad", "decisiones", "inteligencia operativa" | "EUDR", "deadline", "regulatorio", "multa" (a menos que el prospecto lo traiga) |
| B | "EUDR", "trazabilidad", "due diligence", "cumplimiento", "comprador europeo" | "control operativo", "inteligencia de campo" como hook inicial |

**Regla**: Ambas narrativas son verdaderas. No se contradicen — son puertas de entrada diferentes al mismo valor. Una vez que el prospecto entra por una puerta, mantén esa narrativa consistente.

---

## A/B Assignment

- **Método**: Aleatorio 50/50 en la creación del registro `sdr_prospectos`
- **Permanencia**: No cambia durante la vida del prospecto
- **Tracking**: LangFuse event `sdr_session_started` con `{narrativa, segmento_icp}`
- **Resultado de conversión**: LangFuse event `sdr_qualified` o `sdr_meeting_scheduled` permite medir conversión por narrativa

**Hipótesis a validar en H0**:
- Narrativa B convierte más en exportadoras con alto contacto europeo
- Narrativa A convierte más en gerentes de finca sin presión EUDR directa
- Para ONGs, ambas narrativas tienen performance similar (donante = driver, no EUDR)
