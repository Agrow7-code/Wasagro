# Playbook: Objection Matrix
> Version: 1.0 | Date: 2026-04-23

---

## Wasagro SDR — Matriz de Objeciones

Referencia rápida para los 10 patrones de objeción. Ver SP-SDR-05 para prompts detallados.

---

## Mapa de objeciones por segmento

| Objeción | Exportadora | ONG | Gerente Finca |
|----------|-------------|-----|---------------|
| sin_presupuesto | ★★★ Frecuente | ★★ Frecuente | ★★★ Muy frecuente |
| no_tiempo | ★★ Frecuente | ★ Ocasional | ★★ Frecuente |
| ya_tenemos | ★★ Frecuente | ★★ Frecuente | ★ Ocasional |
| mis_trabajadores_no | ★★★ Muy frecuente | ★★★ Muy frecuente | ★★★ Muy frecuente |
| datos_propios | ★★ Frecuente | ★ Ocasional | ★★ Frecuente |
| no_confio_ia | ★ Ocasional | ★ Ocasional | ★★ Frecuente |
| muy_complicado | ★★ Frecuente | ★★ Frecuente | ★★★ Muy frecuente |
| necesito_pensarlo | ★★★ Muy frecuente | ★★ Frecuente | ★★ Frecuente |
| ya_lo_intente | ★★ Frecuente | ★★ Frecuente | ★ Ocasional |
| competidor_mencionado | ★ Ocasional | ★ Ocasional | ★ Raro |

---

## Árbol de decisión para manejo de objeciones

```
¿Hay objeción en el mensaje?
│
├── SÍ → Activar SP-SDR-05 overlay
│         │
│         ├── ¿Es la misma objeción por segunda vez?
│         │   ├── SÍ → Cambiar argumento (no repetir) o proponer demo
│         │   └── NO → Usar respuesta estándar del playbook
│         │
│         └── ¿El score sigue en rango de discovery después?
│             ├── SÍ → Continúa discovery con pivot question
│             └── NO → Evaluar cierre gracioso o propuesta
│
└── NO → Discovery normal (siguiente pregunta priorizada)
```

---

## Tabla resumen: objeción → respuesta → impact

| ID | Acknowledge | Core Reframe | Evidence | Score Impact |
|----|------------|--------------|----------|--------------|
| sin_presupuesto | "Entiendo, el presupuesto es importante." | Piloto de validación antes de comprometerse | Costo de no tener EUDR proof | presupuesto: mantiene 5 |
| no_tiempo | "Hay épocas donde agregar algo es imposible." | 30 segundos de voz para el trabajador | Implementación <1 semana | timeline actualiza |
| ya_tenemos | "Que ya tengan algo demuestra que valoran los datos." | ¿Llega ese sistema al lote? | ERP ≠ captura de campo | calidad_dato actualiza |
| mis_trabajadores_no | "Es la preocupación más frecuente que escuchamos." | WhatsApp voz = sin app, sin login | WhatsApp 90%+ rural | calidad_dato = max |
| datos_propios | "Es exactamente la pregunta correcta." | Aislamiento por finca desde arquitectura | Control de acceso per-finca | sin cambio |
| no_confio_ia | "Válido — hay promesas exageradas con IA." | No toma decisiones — estructura tu voz | Si no entiende, pregunta | sin cambio |
| muy_complicado | "La implementación genera esa preocupación." | 20 segundos de audio = reporte | Sin app, sin login | tamano puede actualizar |
| necesito_pensarlo | "Por supuesto — vale la pena considerarlo." | Demo 20 minutos, datos reales | (no necesita evidence) | champion puede actualizar |
| ya_lo_intente | "Eso duele — una mala implementación frustra." | El canal es WhatsApp, no otra app | Zero-friction adoption | calidad_dato = max |
| competidor_mencionado | "Bien que estés evaluando opciones." | 100% WhatsApp voz, sin app nueva | Canal = diferenciador | sin cambio |

---

## Señales de que la objeción es REAL vs. TÁCTICA

### Objeción real (genuina preocupación)
- El prospecto explica el porqué con detalle
- Hace preguntas de seguimiento después de tu respuesta
- La objeción aparece en contexto relevante
- **Respuesta**: Engage plenamente con la estructura Acknowledge→Reframe→Evidence→Pivot

### Objeción táctica (delay/test)
- Respuesta corta sin contexto ("es caro", "no sé si aplica")
- Aparece en turno 1 antes de conocer el producto
- El prospecto continúa la conversación después
- **Respuesta**: Acknowledge breve + pivot inmediato — no te enganches en el argumento

### Señales de conversación muerta (no invertir más)
- Misma objeción por tercera vez, mismo argumento
- Respuestas de 1 palabra durante 3 turnos seguidos
- Bloqueo explícito: "no me interesa", "no quiero recibir más mensajes"
- **Respuesta**: Cierre gracioso + logging como `descartado`

---

## Reglas de oro del manejo de objeciones

1. **Una objeción = una respuesta.** No respondas con 3 argumentos en cascada.
2. **No debates.** Valida, reencuadra, pregunta. Nunca "estás equivocado en esto..."
3. **Pivot siempre.** Cada manejo de objeción termina con una pregunta de discovery.
4. **No repitas.** Si el mismo argumento no funcionó la primera vez, no lo uses de nuevo.
5. **SDR-G1 siempre activo.** Ningún caso inventado, ninguna estadística sin fuente.
6. **SDR-G4 siempre activo.** Ninguna urgencia artificial creada por el SDR.
