# 019 — Flywheel de correcciones humanas Sigatoka (feedback → evals)

**Fecha:** 2026-06-14
**Estado:** Aceptada

## Contexto

El sub-pipeline Sigatoka (D29, ADR 016/017) extrae fichas con accuracy variable y, cuando
el checksum o la confianza fallan, deriva el muestreo a revisión humana (D30). Hasta ahora
esa corrección humana se aplicaba al evento y se perdía: no quedaba registro de QUÉ leyó
mal el modelo vs QUÉ era lo correcto. CR5 pide un dataset de evaluación
(`eval_dataset`/`eval_results`) para medir y mejorar accuracy; el flujo de revisión D30 ya
genera la señal de oro (humano corrigiendo al modelo) pero no la capturaba.

La primera prueba real con ficha por WhatsApp reveló además dos problemas de producto:

1. El resumen mostraba "BAJO CONTROL" con una sola columna del bloque DATOS leída, cuando
   la ficha tenía 47% EE2 en otra planta → afirmar control sin los datos viola P1.
2. La sección Seguimiento amontonaba las tablas 11/00 semanas sin que el tomador pudiera
   verificar de un vistazo, y el veredicto de checksum no decía qué columna fallaba.

## Decisión

### Captura del feedback (tabla `sigatoka_correcciones`)

Cada corrección humana persiste una fila: `evento_id` (FK a `eventos_campo` con
`on delete cascade`), `finca_id`, `punto`, `campo`, `valor_extraido`/`estado_extraido` (lo
que leyó el modelo), `valor_corregido` (lo que puso el humano), `fuente`
(`asesor_ui` | `tomador_whatsapp`), `creado_por`. RLS: solo el service role escribe/lee. El
insert es best-effort: nunca tumba la corrección del evento (P4 — el error se loggea a
LangFuse). Migración `20260610000061_add-sigatoka-correcciones.sql`.

### `aplicarCorrecciones` vs `aplicarAclaraciones`

- `aplicarAclaraciones` (existente): solo completa celdas `ilegible`, nunca pisa una
  `leida`. Es para el follow-up del tomador por WhatsApp.
- `aplicarCorrecciones` (nuevo, P7): acción humana explícita del asesor desde la UI que
  PUEDE pisar celdas ya leídas. Devuelve `{ sigatoka, aplicadas, ignoradas }` para que la
  UI confirme qué se aplicó y qué se descartó (fila/campo inexistente, valor null).

Ambas recalculan el checksum y regeneran los `camposDudosos` de checksum (no quedan stale
tras corregir): un muestreo ya corregido sale de `requires_review` si todo cuadra.

### Resumen WhatsApp por sub-bloques + guard P1

- Seguimiento se reestructura: cada tabla (11/00 sem) como sub-bloque con su veredicto de
  checksum inline y promedios; el detalle de checksum dice la columna y los números
  (suma vs ficha).
- Si `resumenColumnas` < 3 (bloque DATOS leído parcial), el estado general no puede ser
  "BAJO CONTROL" → "LECTURA INCOMPLETA", y el evento va a `requires_review`.

### UI de corrección (extiende D30)

`SigatokaRevisionView` agrega modo edición de cualquier celda (no solo ilegibles), envía
`correcciones[]` al PATCH, botón de aprobación (`marcar_revisado`, P7), acepta coma
decimal y filtra valores no numéricos.

## Consecuencias

**Gana:**
- Se cierra el loop de calidad: correcciones humanas → dataset → (futuro) evals/few-shots
  → mejor modelo → menos correcciones. Es la base concreta de CR5.
- P1 reforzado: nunca se afirma control sin los datos; las correcciones del asesor son
  acción humana trazada (P7).
- El tomador verifica de un vistazo (veredicto por tabla con columna y números).

**Pierde / trade-offs:**
- Una tabla nueva y un write path adicional en el flujo de revisión (mitigado: insert
  best-effort, no transaccional con el evento).
- El dataset todavía no tiene consumidor: el harness de evals es trabajo futuro (CR5).

**Dependencias:** D29 (extracción), D30 (UI de revisión = superficie de captura), ADR 017
(checksum), CR5 (evals). Numeración coordinada con D31/ADR 018 (seguridad), que mergeó
primero a `main`.
