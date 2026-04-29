# 006 — Patrón Initiator-Sub-Agent con pg-boss por intención

**Fecha:** 2026-04-28
**Estado:** Aceptada
**Reemplaza:** D9 (multi-intent extraction con Promise.all)

## Contexto

Wasagro procesa mensajes de WhatsApp que pueden contener múltiples intenciones (ej: "Apliqué Entrust, gasté $20, me sobró 1 litro" → insumo + gasto). La arquitectura anterior (D9) ejecutaba extractores especializados en paralelo con `Promise.all` dentro de un solo job de pg-boss.

**Problema:** Si Railway mata el proceso mientras un extractor se está ejecutando, TODOS los resultados se pierden — incluyendo los que ya habían completado exitosamente. No hay checkpoint individual por intención. Además, 3 intenciones paralelas pueden golpear los límites de tasa (429) de las APIs de IA sin control de concurrencia.

## Decisión

Adoptar el patrón **Initiator-Sub-Agent** desacoplando la clasificación de la ejecución:

1. **IntentGate (Agente Iniciador):** Un modelo Tier 1 fast (Gemini Flash / Groq Llama) clasifica el mensaje y devuelve un array JSON de intenciones detectadas. No ejecuta extracción.

2. **Encolamiento por intención:** Cada intención se encola como un job independiente en pg-boss: `boss.send('procesar-intencion', intencion)`. Cada job tiene su propio `retryLimit: 3` y `retryBackoff: true`.

3. **Worker por intención (Sub-agente):** Cada worker procesa una sola intención: ejecuta `#extraerEspecializado`, guarda el evento (checkpoint), y marca la intención como completada en la sesión.

4. **Coordinación en sesión:** La sesión guarda un array `intenciones_pendientes` con el status de cada intención. Cuando todas completan, se envía la confirmación al agricultor.

5. **WAIT-CAP-STOP para concurrencia:**
   - **WAIT:** Si el worker recibe un 429 con `Retry-After`, espera el tiempo indicado antes de reintentar (exponential backoff).
   - **CAP:** Si hay múltiples 429s consecutivos, reduce dinámicamente `maxThreads` para evitar saturar las APIs.
   - **STOP:** Si se alcanzan 5 errores 429 consecutivos, aborta el job y lo marca como fallido. pg-boss reintentará automáticamente.

## Consecuencias

### Positivas
- **Resiliencia a reinicios:** Si Railway mata el proceso, pg-boss solo reintentará las intenciones que no completaron. Las que ya guardaron checkpoint quedan intactas.
- **Checkpoint granular:** Cada intención se persiste individualmente. Un gasto guardado no se pierde si el extractor de aplicación falla.
- **Control de concurrencia:** Las estrategias WAIT-CAP-STOP previenen cascadas de errores 429.
- **Observabilidad:** Cada intención tiene su propio trace en LangFuse.
- **Backpressure natural:** pg-boss limita la concurrencia con `teamSize` y `teamConcurrency`.

### Negativas
- **Latencia incrementada:** La clasificación (IntentGate) es una llamada LLM adicional antes de la extracción. Sin embargo, es Tier fast (<1s) y evita el Promise.all que podía tardar 10-20s.
- **Complejidad de coordinación:** La sesión ahora tiene un estado `processing_intentions` y un mecanismo de conteo de intenciones completadas/fallidas.
- **Confirmación diferida:** El usuario ya no ve el resumen inmediatamente después de enviar el mensaje. Ve "Procesando tus N reportes..." y recibe la confirmación cuando todos los workers completan.

### Riesgos mitigados
- Si un worker individual falla 3 veces, pg-boss lo marca como `failed`. Los otros workers no se ven afectados.
- El mecanismo de `singletonKey` en la cola `procesar-mensaje` previene duplicados a nivel de mensaje.
- Cada job `procesar-intencion` tiene su propio retry budget.

## Implementación

- `src/integrations/llm/IntentGate.ts` — Clasificador Initiator (Tier fast)
- `src/workers/pgBoss.ts` — Worker `procesar-intencion` con WAIT-CAP-STOP
- `src/pipeline/handlers/EventHandler.ts` — Encolamiento por intención
- `src/pipeline/supabaseQueries.ts` — Funciones `guardarLoteIntenciones`, `marcarIntencionCompletada`, `marcarIntencionFallida`
- `src/types/dominio/EventoCampo.ts` — Tipos `IntencionDetectada`, `ResultadoIntentGate`
