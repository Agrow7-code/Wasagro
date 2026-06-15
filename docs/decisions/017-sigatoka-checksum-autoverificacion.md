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

---

## Crop-assisted extraction (fallback full-frame)

**Fecha de adición:** 2026-06-15

### Problema

Validado empíricamente: en la foto completa de la ficha, el modelo lee ~14 de ~19 filas
de las tablas de semanas (11sem/00sem). La región es densa y pequeña en proporción a la
imagen; los dígitos aparecen ilegibles a resolución de foto. Al recortar la región y
reescalarla 3× antes de enviarla al LLM, la cobertura sube a ~18 filas.

### Decisión

Recovery **perezoso (lazy)**: el caso común sigue siendo **4 pasadas full en paralelo**.
El crop NO corre siempre — solo cuando una tabla NO cuadra el checksum. Se descartó el
diseño "6 pasadas en paralelo" (4 full + 2 crop) porque saturaba el rate-limit del
proveedor (tier ultra) y causaba cascada de fallos de las pasadas full.

Flujo de `recuperarTabla(idx, region, …, full)` por tabla de semanas:
1. Si `full.totales` es null o el checksum del full ya cuadra → devolver el full (no se
   gasta crop).
2. Si no cuadra → recortar con `sharp`, **zoom 4× + preprocesado** (ver abajo) esa región y
   correr la pasada sobre el crop; `elegirMejorTabla(full, crop, totalesRef)` elige.
3. **Reconciliación cross-field (Etapa A, gratis)**: `reconciliarCrossField` corrige celdas
   donde una columna contradice a su correlato, gateado por el total (ver abajo).
4. Si AÚN no cuadra → `reExtaerConHint` sobre el full (hint correctivo).

Las dos tablas se recuperan **secuencialmente** (no concurrente) para no disparar dos
crops a la vez y volver a presionar el rate-limit.

#### Preprocesado de imagen (estándar IDP/banca)
`#recortarRegion` aplica, además del zoom, un pipeline de legibilidad: escala de grises
(quita ruido de tinta azul) → `normalize` (estira contraste a rango completo) → `sharpen`
(marca trazos de dígitos). Sube la legibilidad del manuscrito sin llamadas LLM extra.
Zoom configurable por región — validado: 4× resuelve misreads de dígito que 3× no.

#### Reconciliación cross-field (corrector-oráculo, Etapa A)
En la ficha LOGBAN ciertas columnas son casi idénticas por fila — validado: **H.T ≈ Q>5%**
(sus `T=` coinciden). Cuando el modelo lee una distinta de la otra, una está mal. Si la
columna que no cuadra toma el valor de su correlato donde difieren Y eso hace cuadrar el
`T=` exacto → se adopta (**doble compuerta**: relación estructural + total). Si no cierra
exacto → no se toca (P1: no adivinar). Solo se usan relaciones VERIFICADAS
(`CORRELACIONES_SEMANA = [['ht','q5mas']]`); una relación falsa corregiría mal. Costo cero
(aritmética pura, función testeable en `SigatokaHandler.ts`).

Regiones usadas (fracciones, generosas para que el zoom 4× no corte la fila T=):
- 11sem: `{ left: 0.53, top: 0.08, width: 0.47, height: 0.40, zoom: 4 }`
- 00sem: `{ left: 0.53, top: 0.44, width: 0.47, height: 0.42, zoom: 4 }`

`elegirMejorTabla(full, crop, totalesRef)` selecciona el ganador por prioridad:
1. Uno nulo/sin filas → el otro gana.
2. `cuadraTodo === true` gana sobre `false`.
3. Más columnas con `cuadra === true`.
4. Más filas con dato (cobertura). El empate favorece el primer argumento (full).

`totalesRef` es siempre el `T=` del full-frame (referencia autoritativa); el crop puede no
capturar la fila T=, por eso nunca sobreescribe el total persistido.

### Propiedades

- **Carga acotada**: caso común = 4 pasadas; el crop se gasta solo cuando una tabla no
  cuadra. No presiona el rate-limit del proveedor (a diferencia del 6-paralelo descartado).
- **Latencia**: extra solo cuando una tabla falla el checksum (justo cuando conviene gastar
  más); el caso OK no agrega nada.
- **Sin regresión posible**: si `sharp` falla (imagen inválida, memoria) → `#recortarRegion`
  devuelve null → se mantiene el full-frame sin condición. El keep-logic del hint adopta el
  reintento solo si mejora estrictamente el checksum (o, en empate, recupera más filas) —
  más conservador que el `>= original` previo.
- **Observabilidad**: `sigatoka_crop_elegido` trazado en LangFuse con `{tabla, fuente, filas_full, filas_crop}`.
- **Testeable**: `filasConDato` y `elegirMejorTabla` son funciones puras exportadas
  de `SigatokaHandler.ts` con suite de tests unitarios.

### Archivos afectados

- `src/integrations/llm/WasagroAIAgent.ts` — `extraerMuestreoSigatoka`, `#recortarRegion`
- `src/pipeline/handlers/SigatokaHandler.ts` — `filasConDato`, `elegirMejorTabla`, `ResultadoTabla`
- `tests/pipeline/SigatokaHandler.test.ts` — tests unitarios de los nuevos helpers
