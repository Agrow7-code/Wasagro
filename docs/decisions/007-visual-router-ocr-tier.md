# 007 — Enrutador Visual Dinámico: tier OCR dedicado con guardrails Zod

**Fecha:** 2026-04-28
**Estado:** Aceptada
**Extiende:** D7 (clasificación de imágenes), D3 (router tiered)

## Contexto

El pipeline de imágenes (D7) clasifica y enruta correctamente (`plaga_cultivo` → V2VK, `documento_tabla` → OCR). Sin embargo, AMBOS paths usaban `modelClass: 'ultra'` (Gemini 1.5 Pro). Esto tiene dos problemas:

1. **Clasificador sobre-dimensionado:** Determinar si una imagen es una hoja o un papel no necesita un modelo multimodal de $0.01/image. Un modelo fast ($0.001/image) basta con >95% accuracy.

2. **OCR sub-especializado:** Gemini Pro no está optimizado para compresión óptica de documentos manuscritos. DeepSeek-OCR y InternVL 3.0 dominan los benchmarks 2026 en box-free parsing y handwritten OCR. Usar un generalista para leer "20 usd" escrito con bolígrafo en papel arrugado es un antipatrón — el modelo devuelve texto donde se espera un número, y la inserción en Supabase crashea.

3. **Sin guardrails de salida:** El OCR devolvía JSON sin validación. Si el LLM generaba `monto: "$20"` en vez de `monto: 20`, el tipo `number` de Supabase rechazaba la inserción. El dato se perdía silenciosamente.

## Decisión

1. **Nuevo `ModelClass: 'ocr'`** en `ILLMAdapter` — tier 4 dedicado para procesamiento de documentos con compresión óptica. No es `ultra` (multimodal generalista), no es `fast` (texto plano). Es un contrato distinto.

2. **Clasificador baja a `fast`** — `clasificarTipoImagen()` usa `modelClass: 'fast'`. Latencia <1s, costo 10x menor.

3. **OCR usa tier `ocr`** — `extraerDocumentoOCR()` usa `modelClass: 'ocr'` que enruta a DeepSeek-OCR (vía NVIDIA API) o InternVL 3.0 como fallback.

4. **Guardrails de salida Zod** — `ResultadoOCRSchema` valida TODO campo del output antes de persistir. Transformaciones automáticas: `"20"` → `20`, `"$20.50"` → `20.5`, `"veinte"` → `null` (con ilegible=true). Si Zod falla, se hace fallback graceful con advertencia en vez de crashear.

5. **Fallback a ultra** — Si no hay API keys de OCR (`NVIDIA_OCR_KEY` / `NVIDIA_INTERVL_KEY`), el pool automáticamente replica los adapters `ultra` existentes como fallback `ocr`. Loggea warning.

## Consecuencias

### Positivas
- **Costo reducido:** Clasificador 10x más barato. OCR especializado tiene mejor accuracy que Gemini Pro en documentos manuscritos.
- **Guardrails de salida <10ms:** Zod intercepta formatos incorrectos ANTES de la inserción en Supabase. La base de datos nunca recibe un string donde se espera un número.
- **Fallback graceful:** Zod failure → datos parciales con advertencia, no crash. Sin adapters OCR → fallback a ultra con warning. Sistema nunca se queda sin path.
- **Contrato extensible:** Si un nuevo modelo OCR supera a DeepSeek-OCR (ej: GPT-5 Vision), se añade al tier `ocr` en el pool sin tocar WasagroAIAgent.

### Negativas
- **Dependencia de NVIDIA_API_KEY para OCR:** Si no hay keys dedicadas, el fallback a ultra funciona pero con peor accuracy en manuscritos.
- **Zod adds ~2ms de latencia por validación:** Despreciable frente a los 5-15s del LLM call.
- **Pool más grande:** 4 tiers en vez de 3. Más adapters para monitorear en LangFuse.

## Implementación

- `src/integrations/llm/ILLMAdapter.ts` — `ModelClass` extendido con `'ocr'`
- `src/types/dominio/OCR.ts` — `ResultadoOCRSchema`, `RegistroOCRSchema` con transformaciones
- `src/integrations/llm/IWasagroLLM.ts` — `ResultadoOCR` importado desde `OCR.ts`
- `src/integrations/llm/WasagroAIAgent.ts` — `clasificarTipoImagen` → `fast`, `extraerDocumentoOCR` → `ocr` + Zod
- `src/integrations/llm/index.ts` — Pool con tier `ocr` (DeepSeek-OCR, InternVL) + fallback a ultra
- `src/integrations/llm/GeminiAdapter.ts` — Soporte para `modelClass: 'ocr'` (fallback a ultra model)
- `prompts/sp-03d-ocr-documento.md` — Reescrito para modelo OCR especializado con tabla de tipos Zod
- `tests/integrations/llm/OCRSchema.test.ts` — Unit tests del schema Zod
- `tests/integrations/llm/OCRFlow.test.ts` — Integration tests del flujo OCR con mock adapter
