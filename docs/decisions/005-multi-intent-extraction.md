# 005 — Extracción multi-intento para mensajes compuestos

**Fecha:** 2026-04-28
**Estado:** Aceptada

## Contexto

Los agricultores no hablan en JSON. Un mensaje real era: "Apliqué Entrust, gasté $20, me sobró 1 litro". El extractor monolítico tenía que elegir un solo tipo de evento. Si elegía `aplicacion_insumo`, se perdía el gasto de $20. Si elegía `nota_economica`, se perdía la aplicación del producto.

El patrón era sistemático: los mensajes de mayor densidad de información — exactamente los más valiosos para el negocio — eran los que el sistema peor estructuraba. La métrica norte (eventos correctamente estructurados) se veía directamente afectada.

## Decisión

Separar la extracción en dos pasos:

1. **Clasificación de intención** (tier `fast`): el LLM determina qué tipos de eventos están presentes en el mensaje. Puede retornar múltiples: `['aplicacion_insumo', 'nota_economica']`.

2. **Extracción especializada en paralelo** (`Promise.all`): por cada intención detectada, se lanza un extractor dedicado con su propio prompt especializado. Los resultados se acumulan en `ExtraccionMultiEvento`.

Cada extractor corre de forma independiente — un fallo en uno no bloquea a los demás.

## Consecuencias

**Gana:**
- Un mensaje con 3 intenciones genera 3 eventos en la base de datos — ninguno se pierde
- Los extractores especializados son más precisos que un extractor genérico (prompt más corto, menos confusión)
- Fallos parciales son manejables: los extractores exitosos se guardan, el fallido va a `requires_review`

**Pierde/Riesgo:**
- N llamadas LLM paralelas por mensaje en lugar de 1 → mayor costo y más posibles fallos de API. Mitigación: tier `fast` es barato (Groq/Flash)
- El clasificador de intención puede fallar en mensajes con > 3 intenciones o intenciones muy ambiguas. En ese caso, el fallback es `nota_libre` con `requires_review` (P1 + P2 del CLAUDE.md se mantienen)
- Mayor complejidad en `WasagroAIAgent.extraerEventos()` — requiere tests de integración para las combinaciones más frecuentes

## Implementación

- `src/integrations/llm/WasagroAIAgent.ts` — `extraerEventos()` con `Promise.all`
- `prompts/sp-01a-extractor-insumo.md` — añadidos campos `cantidad_sobrante` y `unidad_sobrante`
- `src/types/dominio/EventoCampo.ts` — tipo `ExtraccionMultiEvento`
