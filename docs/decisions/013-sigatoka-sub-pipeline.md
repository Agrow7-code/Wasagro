# 013 — Sub-pipeline de muestreo Sigatoka sobre `documento_tabla`

**Fecha:** 2026-06-08
**Estado:** Aceptada provisionalmente — pendiente validación end-to-end con el primer formulario procesado en producción
**Extiende:** D7 (clasificación de imágenes), D11 (tier OCR), D17 (live query a Supabase)

## Contexto

Los supervisores de fincas bananeras llenan a mano un formulario estándar de muestreo de Sigatoka negra ("LOGBAN" o "MUESTREO DE SIGATOKA EN PLANTAS DE 3 METROS Y PLAGAS"). Estructura típica:

- **Encabezado**: zona, código finca, semana, período, fecha, supervisor.
- **Tabla matricial**: 19 puntos (P1..P19) × 3 plantas por punto, cada celda con un estadio de Sigatoka (EE1..EE6) y opcionalmente piscas entre paréntesis (ej. `2(3)` = estadio 2, 3 piscas).
- **Columnas adicionales por punto**: H+VLE (hoja más vieja libre de estría), H+VLQ<5% (libre de quema), FUNC (hojas funcionales), marcas N/V (nueva/vieja) o PR/T/EF.
- **Bloque de 24 plantas numeradas**: EF PAS, EF ACT, referencia.
- **Plantas de 11 semanas**: HT, H+VLE, Q<5%, Q>5%, LC.
- **Plagas foliares**: Ceramida (H/P/M), Sibine (H/P/M). Columna G obsoleta.
- **Resumen con fórmulas**: A..G totales; H..M porcentajes y promedios calculados a mano por el supervisor (H=(C/A)·100, K=B/A, etc.).

Hoy el supervisor lo transcribe a Excel manualmente — proceso que toma 30-45 min por muestreo, y los errores aritméticos en las fórmulas H..M son frecuentes.

**El OCR genérico (D11, `sp-03d`) no resuelve esto.** Está afinado para planillas tabulares simples con filas tipo `actividad + producto + cantidad + monto`. Frente a un formulario de Sigatoka:

- Devuelve `tipo_documento: 'otro'`.
- **Resume** la tabla ("Tabla de 24 puntos con valores registrados") en vez de transcribirla. Los datos numéricos por punto se pierden ANTES del post-procesamiento.
- Intenta forzar la matriz en su esquema `registros[]` y termina con 1 registro basura.
- `confidence_score: 0.55`, `requiere_validacion: false`.

Validado empíricamente con foto real de finca F001 (evento `97288323-67ff-4dfa-ab2a-16fc0cf5d930`, 2026-06-08).

## Decisión

### 1. Sub-clasificador keyword-based sobre el texto del OCR genérico

`detectarFormularioSigatoka(texto)` cuenta marcadores en `texto_completo_visible` que devuelve `sp-03d`. Marcadores: `SIGATOKA`, `H+VLE`, `EF PAS`, `EF ACT`, `FUNC`, `EE2`, `EE3`, `CERAMIDA`, `SIBINE`. Threshold 3+ matches → es formulario de Sigatoka.

**No requiere llamada LLM adicional** — reutiliza el output del OCR ya hecho. Costo marginal: parsing de string en memoria.

### 2. Extractor Vision especializado

`extraerMuestreoSigatoka(base64, mimeType, traceId, costCtx)` añadido a `IWasagroLLM`. Implementación en `WasagroAIAgent`:

- Prompt: `sp-03e-muestreo-sigatoka.md` con reglas explícitas (3 columnas H = 3 plantas distintas, `2(3)` = estadio + piscas, columna G obsoleta, marcas PR/T/EF como string crudo en `marcaEspecial`).
- `modelClass: 'ocr'` (mismo tier que D11 — DeepSeek-OCR / Nemotron / Kimi).
- Retry máximo 2 con feedback Zod explícito en intentos 1 y 2.
- Validación con `SigatokaMuestreoSchema` (Zod).
- Eventos LangFuse: `sigatoka_form_detected`, `sigatoka_parse_error`, `sigatoka_calc_error`, `sigatoka_zod_retry`, `sigatoka_zod_exhausted`.

### 3. Recálculo determinista de fórmulas

`calcularResumen(raw)` en `SigatokaHandler.ts` aplica las fórmulas oficiales del formulario:

| Campo | Fórmula |
|-------|---------|
| H = % plantas EE2 (1-3) | `(C/A) × 100` |
| I = % plantas EE2 (4+)  | `(D/A) × 100` |
| J = % plantas EE3-6     | `(E/A) × 100` |
| K = Prom. H+VLE         | `B/A` |
| L = Prom. H+VLQ<5%      | `F/A` |
| M = Prom. hojas funcionales | `G/A` |

Los valores que escribió el supervisor en el papel se guardan en `*_formulario`. Los recalculados se guardan en `*_calculado`. `detectarCamposDudosos(resumen)` compara campo por campo (umbral diff > 0.5) y produce strings legibles tipo `"resumen.K (calculado: 6.7, formulario: 9.0)"`.

### 4. Alertas agronómicas hardcodeadas

`buildWhatsappSummary(data, camposAclarar)` activa alertas en el mensaje:

- `J_calculado > 10` → "% plantas con EE3-6 — revisar programa de fumigación"
- `I_calculado > 5` → "% plantas con EE2 avanzado (estadios 4+)"
- `M_calculado < 9` → "Promedio hojas funcionales bajo — evaluar nutrición"

Umbrales válidos para banano de exportación en Ecuador/Costa Rica/Guatemala según consulta con agronomía de F001. Si una segunda finca aparece con umbrales distintos → parametrizar por finca en D30 (no anticipar).

### 5. `requiereValidacion` derivado

`requiereValidacion: true` cuando:
- `confidenceScore < 0.75` (el modelo Vision marcó incertidumbre), O
- `camposDudosos.length > 0` (hay discrepancias entre escrito y calculado).

El caller (`EventHandler`) marca el evento como `status: 'requires_review'` cuando esto ocurre. Los primeros 2 campos dudosos se incluyen en el mensaje de WhatsApp como aviso al supervisor.

### 6. Persistencia en `eventos_campo` + JSONB (NO tabla nueva)

```typescript
saveEvento({
  tipo_evento: 'observacion',
  status: sigatoka.requiereValidacion ? 'requires_review' : 'complete',
  datos_evento: {
    tipo_documento: 'muestreo_sigatoka_banano',
    sigatoka,                              // SigatokaMuestreo completo
    caption: msg.texto ?? null,
    texto_ocr_origen: ocr.texto_completo_visible,
  },
  descripcion_raw: buildDescripcionRaw(sigatoka),  // para RAG
  confidence_score: sigatoka.confidenceScore,
  requiere_validacion: sigatoka.requiereValidacion,
})
```

Esto preserva integración con:
- `view_analisis_eventos` (D26)
- Motor de métricas y calculadora por finca (D18)
- Resumen semanal por finca (D14)
- RAG D12 (`descripcion_raw` se indexa)
- RLS por org (D41)
- Cost tracking (D27)

Una tabla aparte hubiera roto las 6.

### 7. Flujo end-to-end

```
foto WhatsApp
  → EventHandler.resolverMediaImagen() [media.base64]
  → _llm.clasificarTipoImagen() = 'documento_tabla'
  → _llm.extraerDocumentoOCR() [sp-03d → ocr genérico]
  → detectarFormularioSigatoka(ocr.texto_completo_visible)
       └─ true? → _llm.extraerMuestreoSigatoka() [sp-03e → vision + Zod]
            └─ calcularResumen + detectarCamposDudosos
            └─ saveEvento con tipo_documento='muestreo_sigatoka_banano'
            └─ sender.enviarTexto(buildWhatsappSummary)
       └─ false? → flujo OCR genérico existente (no cambia)
```

## Consecuencias

### Positivas

- Datos del formulario se capturan estructurados en vez de perderse en `texto_completo: "Tabla de 24 puntos..."`.
- Errores aritméticos del supervisor se detectan automáticamente (`camposDudosos`).
- Alertas agronómicas inmediatas vía WhatsApp sin pasar por dashboard.
- Sin tabla nueva — integración automática con vistas, métricas, RAG, RLS, cost tracking existentes.
- `detectarFormularioSigatoka` queda como red de seguridad por si el clasificador upstream (sp-03c) se confunde.

### Negativas

- **Costo: 2 llamadas Vision por foto Sigatoka** (OCR genérico + extractor sp-03e). Mitigación posible en futuro: mover detección al clasificador sp-03c (`'muestreo_sigatoka_banano'` como cuarto valor del enum `TipoImagen`) — ahorra 1 LLM call. No se hace ahora porque (a) la detección keyword-based ya funciona, (b) sp-03c tendría que ser robusto a variantes visuales del formulario.
- **Umbrales hardcodeados** (J>10, I>5, M<9). Si fincas tienen criterios distintos, requiere parametrización por finca.
- **Sub-clasificador depende del output del OCR genérico.** Si sp-03d cambia su prompt y empieza a no transcribir los headers, el sub-clasificador queda ciego. Mitigación: tests de regresión sobre `MARCADORES_SIGATOKA`.
- **Falsos positivos posibles**: un documento que contenga 3+ marcadores por coincidencia (ej. una nota de campo que mencione "sigatoka", "ee2", "ceramida") sería rutado al extractor sp-03e — que devolvería confidenceScore bajo y `requiereValidacion: true`. Aceptable: no rompe nada, solo gasta 1 LLM call de más.

## Implementación

- `src/types/dominio/SigatokaMuestreo.ts` — schema Zod + 7 types
- `src/types/dominio/OCR.ts` — `'muestreo_sigatoka_banano'` añadido a `TipoDocumentoOCR` y a `ResultadoOCRSchema.tipo_documento`
- `src/pipeline/handlers/SigatokaHandler.ts` — `calcularResumen`, `detectarCamposDudosos`, `detectarFormularioSigatoka`, `extractSigatokaMuestreo`, `buildDescripcionRaw`, `buildWhatsappSummary`
- `src/integrations/llm/IWasagroLLM.ts` — método `extraerMuestreoSigatoka` añadido
- `src/integrations/llm/WasagroAIAgent.ts` — implementación con retry x2 + LangFuse trace + Zod
- `src/pipeline/handlers/EventHandler.ts` — rama Sigatoka antes del save del OCR genérico
- `prompts/sp-03e-muestreo-sigatoka.md` — prompt Vision
- `tests/pipeline/SigatokaHandler.test.ts` — 32 tests (cálculo, detección, summary, schema, integración)

## Revisar cuando

1. **Primer formulario en producción confirma o desmiente la decisión.** Si el extractor `sp-03e` extrae basura por mala lectura del Vision, o si las fórmulas se rompen con datos reales, esta decisión se revisa.
2. **Aparece un segundo formulario agrícola** (ej. registro de cosecha con formato propietario, planilla de Botritis en uvas) que justifique generalizar el patrón "sub-clasificador + extractor especializado" como infraestructura en vez de una rama por formulario.
3. **Una finca requiere umbrales agronómicos distintos** a los hardcodeados → parametrizar en una tabla `umbrales_agronomicos_finca` (extensión natural de D18).
4. **`MARCADORES_SIGATOKA` genera falsos positivos** sobre documentos no-Sigatoka → endurecer reglas (combinaciones obligatorias) o subir threshold.
5. **Volumen de muestreos** supera 100/semana por finca → considerar mover detección a sp-03c para ahorrar el OCR genérico previo (~$0.005 × N fotos).

## Actualización 2026-06-08 — detección binaria `sp-03g` (Nivel A robusto) + Gemini primario en tier OCR

**Contexto.** El primer test end-to-end con fichas Dole/LOGBAN reales (foto 1 A-MICHELI, foto 2 Viva Esperanza) destapó DOS fallas que impedían rutear al extractor:

1. **El clasificador `sp-03c` nunca devolvía `muestreo_sigatoka_banano`.** Con 4 opciones y una imagen dominada por una tabla manuscrita densa, el modelo ancla en `documento_tabla` (probado con `gemini-3.1-flash-lite`, `gemini-2.5-flash`) o `otro` (`gemini-3-flash`). NO es fuerza de modelo ni legibilidad: el MISMO `gemini-3.1-flash-lite`, con un prompt binario enfocado ("¿el encabezado dice MUESTREO DE SIGATOKA/LOGBAN? sí/no"), lee el título perfecto en ambas fotos. El prompt multiopción, por más explícito que sea su PASO 0, diluye la señal del título.
2. **El tier `ocr` estaba caído.** `nvidia/nemotron-ocr-v1`, `deepseek-ai/deepseek-ocr-v2`, `nvidia/internvl-3.0-78b` → 404; Kimi-K2.6 → timeout. `extraerDocumentoOCR` tiraba `LLMError` y el usuario recibía "Tuve un error con tu imagen". El fallback `ultra→ocr` de `index.ts` no disparaba porque los adapters OCR SÍ estaban registrados (fallan en runtime, no en init).

**Decisión.**

- **Detector binario `detectarFichaSigatoka`** (`prompts/sp-03g-detector-sigatoka.md`, tier `fast`, fallback `false`). Una sola pregunta sí/no. Se corre en `Promise.all` junto a `clasificarTipoImagen` en `EventHandler` (sin latencia extra); su `true` gana → `tipoImagen = 'muestreo_sigatoka_banano'` → ruta directa al extractor (tier `ultra`/Gemini, sano), **evitando por completo el OCR genérico**. `classifier_source` registra `sp-03g_binary` vs `sp-03c_direct`.
- `detectarFormularioSigatoka` (Nivel B, keyword sobre el OCR) queda como red de seguridad terciaria; ya casi nunca se ejerce porque el Nivel A binario resuelve antes.
- **Gemini-OCR primario en tier `ocr`** (`gemini-2.5-flash` antes de los NVIDIA en `index.ts`) + `timeoutMs: 35_000` en `extraerDocumentoOCR` para que complete en un intento (sin apilar 3 reintentos ~76s). Esto repara el OCR genérico para CUALQUIER documento, no solo Sigatoka.

**Consecuencias.**
- Sigatoka ahora se detecta de forma fiable y rápida; el extractor (Gemini ultra) no depende del tier OCR muerto.
- Validado contra foto 1 y foto 2: ambas → `muestreo_sigatoka_banano` (`detector_binario=true`).
- **Pendiente:** los IDs NVIDIA del tier OCR siguen dando 404 — verificar nombres correctos en el catálogo NVIDIA NIM (ver D11/ADR 007). El OCR genérico de tablas muy densas con Gemini ronda los ~30s (límite de P3); aceptable como piso, optimizable.
- Costo: el detector binario agrega 1 llamada `fast` por imagen, pero corre en paralelo (sin latencia) y para Sigatoka ahorra el OCR genérico previo. Neto favorable.
