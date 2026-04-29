# 003 — Clasificador de imágenes antes del diagnóstico V2VK

**Fecha:** 2026-04-28
**Estado:** Aceptada

## Contexto

Durante pruebas con colegas en H0, surgieron dos fallos concretos:

1. **Foto de trips en racimo de banano** → el sistema intentó diagnosticar con V2VK directamente. Sin RAG histórico (finca nueva), el anti-alucinación de sp-03b rechazaba el diagnóstico. El agricultor recibía silencio o un mensaje de error sin sentido.

2. **Foto de planilla de cosecha manuscrita** → el sistema no tenía forma de distinguirla de una imagen de plaga. Si lograba pasar por V2VK, intentaba diagnosticar una "enfermedad" en el papel. Los datos de la planilla (lotes, kilos, fechas) se perdían por completo.

Antes de esta decisión, el handler de imágenes en `EventHandler.ts` tomaba toda imagen y la enviaba directamente al pipeline V2VK, sin ningún paso previo de clasificación.

## Decisión

Añadir un paso obligatorio de clasificación antes de rutear cualquier imagen. El clasificador asigna una de tres categorías:

- `plaga_cultivo` → Pipeline V2VK (descripción visual + diagnóstico agronómico)
- `documento_tabla` → OCR estructurado (extrae registros en JSON para persistencia)
- `otro` → Descarte con mensaje explicativo al usuario

## Consecuencias

**Gana:**
- Las imágenes de documentos de campo (planillas, registros, cuadernos) generan datos estructurados en lugar de perderse
- V2VK solo recibe imágenes agronómicas → menor rate de fallos + prompts más específicos
- El agricultor recibe feedback útil en los tres casos, no silencio

**Pierde/Riesgo:**
- Un paso más de LLM por imagen → +100-300ms de latencia y +costo por llamada
- El clasificador puede equivocarse en imágenes ambiguas (ej: foto de plaga sobre una planilla de campo). Mitigación: en caso de duda, `plaga_cultivo` es el fallback más útil para el agricultor

## Implementación

- `prompts/sp-03c-clasificador-imagen.md` — prompt del clasificador
- `prompts/sp-03d-ocr-documento.md` — prompt OCR para documentos
- `src/pipeline/handlers/EventHandler.ts` — función `resolverMediaImagen()` + bloque de routing
- `src/integrations/llm/WasagroAIAgent.ts` — métodos `clasificarTipoImagen()` y `extraerDocumentoOCR()`
- `src/integrations/llm/IWasagroLLM.ts` — tipos `TipoImagen`, `ContextoOCR`, `ResultadoOCR`
