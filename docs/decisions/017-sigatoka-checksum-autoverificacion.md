# 017 — Sigatoka: auto-verificación por checksum T= y extracción en 4 pasadas

**Fecha:** 2026-06-09
**Estado:** Aceptada

## Contexto

El pipeline de extracción de fichas Sigatoka (ADR 016) usaba 3 pasadas paralelas, donde
la pasada 2 extraía ambas tablas de semanas (11 y 00) en una sola llamada. Esto generaba
dos problemas:

1. **Pérdida silenciosa de datos**: las columnas H.T, H+VLE, Q<5%, Q>5%, LC de las
   tablas de 11 y 00 semanas se extraían pero nunca aparecían en el resumen WhatsApp ni
   en el schema con estado por celda (solo números planos, sin `ilegible`).

2. **Sin auto-verificación**: el supervisor ya calculó los totales T= y los promedios Pr=
   a mano en la ficha. Si el modelo se salteaba o duplicaba una fila, no había forma de
   detectarlo automáticamente → se necesitaba reprocesar con el tomador.

## Decisión

### 4 pasadas (e2 partida en e2a / e2b)

- `sp-03e2-sigatoka-derecha.md` queda obsoleto. Se reemplaza por dos prompts enfocados:
  - `sp-03e2a-sigatoka-11sem.md`: SOLO tabla 11 semanas + T= + Pr=
  - `sp-03e2b-sigatoka-00sem.md`: SOLO tabla 00 semanas + T= + Pr=
- Las 4 pasadas corren en paralelo (latencia = ~la más lenta, no suma).
- El reintento de pasada fallida se extiende a 4 pasadas.

### FilaSemanaSchema con estado por celda

- Cada columna de la fila es un `CeldaMuestra ({ valor, estado })` en vez de un número
  plano. Esto habilita el follow-up "preguntar al tomador" sobre celdas ilegibles de las
  tablas de semanas (identificador `"11sem-{fila}"` / `"00sem-{fila}"`).
- Backward compat: el preprocess Zod eleva la forma plana antigua (número o null) a
  `CeldaMuestra`, por lo que los datos persistidos antes de esta migración siguen siendo
  válidos.

### Checksum T= vs suma de filas

- `verificarChecksumTabla(filas, totales)`: función pura testeable que compara la suma
  de los valores presentes de cada columna vs el T= de la ficha. Tolerancia ±1 (redondeo).
  Resultado por columna: `cuadra: true/false/null` (null = totalFicha no disponible).
- Tras el merge, si `cuadraTodo === false` para una tabla, se re-extrae ESA pasada
  UNA sola vez con un hint correctivo (sumando lo que el modelo leyó vs lo que dice la
  ficha). Se queda con el resultado que tenga más columnas que cuadran.
- El resultado del checksum se persiste en `verificacion11sem` / `verificacion00sem`
  dentro de `datos_evento.sigatoka` para trazabilidad en la UI de revisión (D30).

### Columna G de plagas foliares

La ficha LOGBAN SGI F09R902 tiene columna G (adultos) en Ceramida/Sibine. Se agrega a
`PlagaFoliarSchema` como campo con `default(null)` para backward compat. `sp-03e3`
actualizado para capturarla.

### pEfFincaT y pEfFincaFrec

`sp-03e3` ahora captura también el total T= y la frecuencia Frec (días) del bloque
P-EF-FINCA, exponiendo más contexto al asesor sin lógica adicional.

## Consecuencias

**Gana:**
- Eliminación de reprocesos manuales: el pipeline se auto-verifica y se auto-corrige
  antes de enviar el resumen al asesor.
- El resumen WhatsApp ahora muestra conteo + promedios de tablas 11/00 semanas y
  veredicto de checksum (✅ / ⚠️).
- El follow-up "preguntar al tomador" cubre también celdas ilegibles de las tablas de
  semanas, no solo los puntos de muestra.

**Pierde / trade-offs:**
- 4 pasadas en paralelo vs 3: misma latencia si todos los proveedores responden a tiempo,
  pero mayor presión sobre el rate-limit del router en fichas simples.
- La re-extracción dirigida puede sumar ~10-12s extra cuando una tabla no cuadra
  (dentro del SLA P3 de 30s porque se hace después del primer round que ya arrojó datos).
- `sp-03e2-sigatoka-derecha.md` queda huérfano; se puede eliminar en una limpieza futura
  una vez confirmado que no hay referencias activas en producción.

**Dependencias:** ADR 016 (pipeline multi-pasada), D29 (sub-pipeline Sigatoka), D30
(UI de revisión de requires_review).
