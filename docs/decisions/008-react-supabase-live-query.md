# 008 — Acceso live a Supabase durante el loop ReAct de extracción

**Fecha:** Mayo 2026
**Estado:** Aceptada

## Contexto

El loop ReAct en `WasagroAIAgent.#extraerEspecializado` ejecuta múltiples iteraciones LLM para estructurar un evento de campo. En cada iteración, el LLM puede emitir un `__tool_call` en lugar de devolver el JSON final — señal de que necesita información adicional para completar la extracción con precisión.

El problema concreto que motivó esto: un agricultor decía "apliqué Cipermetrina al lote tres". El extractor no sabía si "lote tres" era el nombre coloquial de un lote registrado o una descripción imprecisa. Sin acceso a los lotes reales de la finca, el extractor tenía dos opciones malas: inventar el `lote_id` (viola P1 y Regla 1) o marcar como `requiere_clarificacion` (viola P2 si ya se preguntó antes). Con acceso live, puede resolver la ambigüedad sin molestar al agricultor.

## Decisión

El LLM tiene acceso a un conjunto fijo y cerrado de herramientas de solo lectura durante el loop ReAct. Las herramientas están definidas en `src/agents/mcp/SupabaseTools.ts` y son:

1. **`obtener_lotes_finca(finca_id)`** — Retorna la lista de lotes activos de la finca con nombre coloquial y hectáreas. Permite al LLM resolver nombres ambiguos de lotes sin preguntar al usuario.

2. **`consultar_inventario_insumos(finca_id, busqueda?)`** — Retorna el stock disponible de insumos en la bodega. Permite al LLM confirmar el nombre exacto de un producto antes de persistirlo.

Restricciones de diseño:
- **Solo lectura**: las herramientas ejecutan únicamente `SELECT`. No hay `INSERT`, `UPDATE`, ni `DELETE`.
- **Scoped por `finca_id`**: el `finca_id` se inyecta automáticamente desde el contexto del usuario (`safeArgs = { ...args, finca_id: input.finca_id }`), ignorando cualquier `finca_id` que el LLM intente pasar. El LLM no puede acceder a datos de otra finca.
- **Conjunto cerrado**: el LLM solo puede invocar las herramientas que existen en `SupabaseTools`. Una herramienta desconocida retorna error y el loop continúa sin crashear.
- **Doom-loop guard**: si el LLM llama a la misma herramienta con los mismos argumentos dos veces, el sistema detecta el loop y fuerza la extracción final con la información disponible.
- **Observabilidad**: cada tool call emite `trace.event({ name: 'mcp_tool_call' })`. Cada error de ejecución emite `trace.event({ name: 'mcp_tool_execute_error', level: 'ERROR' })`.

## Consecuencias

**Lo que se gana:**
- Resolución de ambigüedad sin preguntas al usuario (respeta P2 — máx 2 clarificaciones).
- `lote_id` y nombres de productos se extraen con mayor precisión al validarse contra datos reales de la finca.
- El LLM nunca inventa un lote que no existe — o lo encuentra en Supabase o lo deja en `null` con `requiere_clarificacion`.

**Lo que se acepta:**
- Latencia adicional por query a Supabase durante la extracción. Mitigado: las queries son simples SELECT con filtro por `finca_id` y están bajo los 100ms en condiciones normales (CR2).
- El LLM toma decisiones sobre qué herramienta invocar — no hay garantía de que use la herramienta correcta en todos los casos. El doom-loop guard previene bucles infinitos.

**Revisar cuando:**
- Se agregue una nueva herramienta al set — requiere evaluación de impacto en latencia y revisión del prompt del extractor para que el LLM sepa cuándo usarla.
- Si las queries de herramientas superan los 500ms en producción, evaluar índices adicionales o cache en memoria para el set de lotes (cambia poco durante el día).
- Si se detecta en LangFuse que el LLM abusa de las herramientas en >30% de las extracciones sin necesidad real, revisar el prompt para desincentivar tool calls innecesarios.
