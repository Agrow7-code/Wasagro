# Playbook: Qualification Scorecard
> Version: 1.0 | Date: 2026-04-23

---

## Wasagro SDR Qualification Scorecard

Referencia completa para el scoring de prospectos. Usar junto con SP-SDR-01.

---

## Score Total: 0–100

| Score | Status | Acción |
|-------|--------|--------|
| ≥ 65 | Qualified | Proponer piloto → aprobación founder |
| 30–64 | In Discovery | Continuar discovery |
| < 30 (después de turno 10) | Unqualified | Cierre gracioso |

---

## Dimensión 1: EUDR Urgency (max 25 pts)

| Señal del prospecto | Puntos | Ejemplo de evidencia |
|--------------------|--------|----------------------|
| Menciona deadline, multas, o riesgo de perder contrato europeo | 25 | "mi importador en Alemania me pide EUDR proof antes de octubre" |
| Conoce EUDR pero no expresa urgencia activa | 15 | "sí, sabemos que viene lo del EUDR" |
| Vende a Europa/USA pero no menciona EUDR | 8 | "exportamos a Alemania hace 5 años" |
| Sin mercado internacional o sin señal EUDR | 0 | No mencionado |

**Regla R1**: El score solo sube con cita directa del prospecto. No inferas urgencia de contexto general.
**Default**: 0

---

## Dimensión 2: Tamaño Cartera (max 20 pts)

| Señal del prospecto | Puntos |
|--------------------|--------|
| Exportadora con 50+ fincas / ONG con 150+ productores | 20 |
| Exportadora con 20–49 fincas / ONG con 50–149 productores | 15 |
| Exportadora con 10–19 fincas / ONG con 20–49 productores | 10 |
| Exportadora con 5–9 fincas / ONG con 10–19 productores | 5 |
| Individual farm / < 5 fincas / ONG < 10 productores | 0 |

**Para gerente_finca** (mapeo por hectáreas):
| Hectáreas | Puntos |
|-----------|--------|
| 50+ ha | 20 |
| 20–49 ha | 15 |
| 10–19 ha | 10 |
| 5–9 ha | 5 |
| < 5 ha | 0 |

**Regla**: Si el prospecto da un rango ("entre 30 y 40 fincas"), usar el límite inferior.
**Default**: 0

---

## Dimensión 3: Calidad del Dato Actual (max 20 pts)

| Sistema actual | Puntos | Razonamiento |
|----------------|--------|--------------|
| Sin registro / verbal únicamente | 20 | Máximo dolor — zero data |
| Libreta de campo / cuaderno manual | 18 | Alta fricción, datos perdidos |
| WhatsApp informal entre trabajadores | 15 | Semi-estructurado, no procesable |
| Excel actualizado manualmente | 12 | Digital pero no en tiempo real |
| App o sistema parcial sin cobertura de campo | 5 | Tiene algo pero no llega al lote |
| Sistema completo de trazabilidad activo | 0 | No tiene pain — no es cliente |

**Nota**: Si el prospecto menciona múltiples métodos, usar el que implica mayor dolor (mayor score).
**Default**: 0 (no asumimos su situación)

---

## Dimensión 4: Champion (max 15 pts)

| Señal del prospecto | Puntos |
|--------------------|--------|
| Decisor directo (dueño, CEO, gerente exportaciones, director) | 15 |
| Gerente con influencia pero requiere aprobación de otro | 7 |
| Técnico sin poder de compra | 3 |
| Gatekeeper confirmado (asistente, coordinador sin autoridad) | 0 |

**Default**: 7 (unknown = partial credit — la mayoría de contactos tienen alguna influencia)
**Señales de gatekeeper**: "necesito consultarlo con mi jefe", "solo estoy investigando opciones para él", "no decido yo"

---

## Dimensión 5: Timeline de Decisión (max 10 pts)

| Señal del prospecto | Puntos |
|--------------------|--------|
| Necesita solución antes de Q2 2026 o menciona "este trimestre" | 10 |
| Quiere solución para fin de 2026 | 7 |
| "Algún día" o "cuando tengamos presupuesto" sin fecha | 3 |
| Sin señal de timeline | 0 |

**Nota**: Si el prospecto dice "antes del Q3" sin año, asumir año actual (2026).
**Default**: 0

---

## Dimensión 6: Presupuesto (max 10 pts)

| Señal del prospecto | Puntos |
|--------------------|--------|
| Presupuesto disponible confirmado | 10 |
| Presupuesto no descartado (sin confirmación explícita) | 5 |
| Objeción de presupuesto manejada exitosamente | 5 |
| Objeción de presupuesto y conversación termina | 0 |

**Default**: 5 (unknown budget = partial credit — no penalizamos la ignorancia)

---

## Ejemplos de scoring completo

### Ejemplo A: Exportadora Ecuador — califica en turno 4

| Dimensión | Señal | Puntos |
|-----------|-------|--------|
| EUDR urgency | "importador en Alemania nos pidió EUDR proof antes de octubre" | 25 |
| Tamaño cartera | "manejamos 38 fincas de cacao" | 15 |
| Calidad dato | "registramos todo en Excel" | 12 |
| Champion | "yo soy la gerente de operaciones, decido" | 15 |
| Timeline | "antes de la próxima temporada, octubre" | 10 |
| Presupuesto | no mencionado | 5 |
| **TOTAL** | | **82 → Qualified** |

### Ejemplo B: Gerente finca individual — no califica

| Dimensión | Señal | Puntos |
|-----------|-------|--------|
| EUDR urgency | sin mención de EUDR ni mercado europeo | 0 |
| Tamaño cartera | "tengo 8 hectáreas de cacao" | 5 |
| Calidad dato | "mi capataz lleva libreta" | 18 |
| Champion | "yo mismo soy el dueño" | 15 |
| Timeline | "cuando tenga plata algún día" | 3 |
| Presupuesto | "no tengo presupuesto para esto" (objeción manejada) | 5 |
| **TOTAL** | | **46 → Continue discovery** |

### Ejemplo C: ONG con grant — califica en turno 5

| Dimensión | Señal | Puntos |
|-----------|-------|--------|
| EUDR urgency | "GIZ nos pide alinearnos con EUDR para renovar el grant" | 15 |
| Tamaño cartera | "tenemos 180 productores en el programa" | 20 |
| Calidad dato | "formularios en papel, digitalizamos a Excel después" | 12 |
| Champion | "yo coordino el programa, apruebo herramientas" | 15 |
| Timeline | "la renovación del grant es en agosto" | 7 |
| Presupuesto | "tenemos línea de digital tools en el presupuesto" | 10 |
| **TOTAL** | | **79 → Qualified** |
