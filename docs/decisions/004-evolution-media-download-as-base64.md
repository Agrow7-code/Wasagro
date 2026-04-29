# 004 — Descarga de media de Evolution API como base64

**Fecha:** 2026-04-28
**Estado:** Aceptada

## Contexto

Evolution API entrega webhooks con URLs de media apuntando al CDN de WhatsApp (`media.cdn.whatsapp.net`). Estas URLs requieren autenticación Bearer que solo tiene la propia instancia de Evolution API — no son accesibles públicamente.

El código inicial en `GeminiAdapter` hacía `fetch(imageUrl)` directamente para obtener los bytes y convertirlos a base64. Esto devolvía 401/403 en el 100% de los casos. El adapter lanzaba una excepción, el handler la capturaba, y el evento se guardaba como `nota_libre` con `status: requires_review`.

El resultado observable: TODA imagen enviada por WhatsApp fallaba silenciosamente. El agricultor no recibía ningún diagnóstico. El equipo no veía error claro porque el fallback a `nota_libre` hacía que el sistema pareciera "funcionar".

## Decisión

Descargar el media como base64 usando el endpoint interno de Evolution API (`POST /chat/getBase64FromMediaMessage/:instance`) antes de pasar cualquier dato al LLM. El payload de descarga incluye `key` y `message` del webhook original, que Evolution API usa para autenticarse con el CDN de WhatsApp.

El base64 resultante + mimeType se almacenan en `NormalizedMessage` (`mediaBase64`, `mediaMimetype`) y se pasan directamente al adapter como `imageBase64` + `imageMimeType` — nunca como URL.

## Consecuencias

**Gana:**
- Las imágenes funcionan. El pipeline V2VK y el OCR reciben datos reales.
- El adapter no necesita credenciales de WhatsApp — solo recibe base64 limpio.
- `GeminiAdapter` mantiene el path `imageUrl` como fallback para futuros proveedores con URLs públicas.

**Pierde/Riesgo:**
- Una llamada HTTP adicional a Evolution API por cada imagen recibida → +200-500ms de latencia
- Si Evolution API está caída, las imágenes fallan aunque el backend esté vivo. Mitigación: el error se loggea en LangFuse y se guarda como `requires_review` — no se pierde el mensaje, se encola para revisión manual.
- Requiere tres variables de entorno adicionales: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`

## Implementación

- `src/integrations/whatsapp/EvolutionMediaClient.ts` — función `downloadEvolutionMedia()`
- `src/integrations/whatsapp/NormalizedMessage.ts` — campos `mediaBase64` y `mediaMimetype`
- `src/integrations/llm/ILLMAdapter.ts` — campos `imageBase64` y `imageMimeType` en `LLMGeneracionOpciones`
- `src/integrations/llm/GeminiAdapter.ts` — path separado para base64 vs URL
- `src/pipeline/handlers/EventHandler.ts` — función `resolverMediaImagen()`
