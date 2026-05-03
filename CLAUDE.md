# Wasagro — CLAUDE.md

> Este archivo es el cerebro del proyecto para Claude Code. Tres capas: principios que nunca cambian, criterios que cualquier herramienta debe cumplir, y decisiones actuales que se revisan con datos.

## Identidad del proyecto

Wasagro es un sistema operativo de campo agrícola AI-first. Captura datos en fincas de exportación (cacao/banano) en Ecuador/Guatemala via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

**Horizonte actual: H0-R — Producto funcional para primera finca pagante.**
**Métrica Norte: Eventos de campo correctamente estructurados por semana por finca activa (accuracy ≥ 85%).**
**Modelo de negocio: B2B enterprise — exportadora paga, agricultor usa gratis.**

> **Por qué cambió el horizonte:** H0 original fue escrito sin probar con usuarios reales. Las primeras pruebas con colegas ingenieros revelaron que el sistema no creaba valor: no identificaba plagas en imágenes, no estructuraba mensajes con múltiples datos, y devolvía errores o preguntas sin sentido. H0-R es el horizonte corregido con dolores reales: el objetivo ya no es "validar el problema" (ese problema existe y está confirmado) sino entregar un producto que funcione en campo antes del primer cliente pagante.

## SSOT — Dónde vive cada cosa

| Capa | Herramienta | Qué vive ahí | Audiencia |
|---|---|---|---|
| Producto (qué, por qué, para quién) | **Notion** | Manual Maestro, hipótesis H0, pipeline ventas, notas de campo, user research | Stakeholders, exportadoras, equipo no-técnico |
| Técnica (cómo, qué se construyó) | **GitHub: Agrow7-code/Wasagro** | Schema SQL, código TypeScript, prompts, docs de arquitectura, ADRs | Ingenieros, Claude Code |
| Steering de desarrollo | **CLAUDE.md** (este archivo) | Principios, criterios de evaluación, decisiones actuales | Claude Code al inicio de sesión |
| Code review | **AGENTS.md** | Guardrails que GGA verifica en cada commit | GGA pre-commit |
| Memoria persistente | **Engram** | Decisiones, bugs, aprendizajes entre sesiones de Claude | Claude Code entre sesiones |

**Regla anti-silo (CRÍTICA):**
- ¿Lo lee un agricultor, exportadora, o stakeholder no-técnico? → **Notion únicamente**
- ¿Lo lee un ingeniero o Claude Code? → **GitHub únicamente**
- ¿Es continuidad de contexto para Claude entre sesiones? → **Engram únicamente**
- **NUNCA duplicar el mismo dato en dos sistemas.** Si está en GitHub, Notion referencia el link, no copia el contenido.

**Repos activos:**
- `Agrow7-code/Wasagro` — repo principal y único activo. Todo vive aquí.
- `Agrow7-code/wasagro-architecture` — **ARCHIVADO**. Sirvió para la fase de planificación inicial. No recibe más commits.

---

## CAPA 1 — Principios invariantes

> Estos principios son independientes de cualquier herramienta, framework, o proveedor. No cambian si migramos de Supabase a otro Postgres, de n8n a Inngest, o de GPT-4o Mini a Voxtral. Si una decisión técnica viola un principio, se cambia la decisión, no el principio.

### P1. El agente nunca inventa datos

Si no tiene información, pregunta. Si no puede extraer un campo, lo marca como `null` con `confidence_score` bajo. Jamás fabrica un lote, una dosis, o un producto. Una asunción incorrecta en agricultura puede causar daño económico real e irreversible.

### P2. Máximo 2 preguntas de clarificación

Después de 2 preguntas sin completar, registrar como `nota_libre` con `status='requires_review'`. Investigación con 200K+ conversaciones demuestra que el rendimiento de LLMs cae 39% en conversaciones multi-turno. No torturar al usuario con preguntas.

### P3. Latencia < 30 segundos

Acuse de recibo al usuario en <5 segundos. Respuesta estructurada completa en <30 segundos. Si el pipeline tarda más, enviar "Estoy procesando tu reporte..." inmediatamente. Un trabajador que camina al siguiente lote tiene 30-60 segundos de ventana de atención.

### P4. Todo error se loggea sin excepción

Toda llamada a LLM, toda transcripción STT, todo error de extracción queda registrado en el sistema de observabilidad. El log incluye: input raw, output estructurado, confidence_score, modelo usado, latencia. No existen catch vacíos ni errores silenciosos.

### P5. Los datos del campo pertenecen a la finca

Wasagro tiene licencia de uso para procesar datos, no propiedad. La exportadora solo ve lo que la finca autoriza. Ningún dato se agrega o vende sin consentimiento explícito. Todo evento conserva `descripcion_raw` (input original) junto al JSON estructurado.

### P6. Consentimiento antes de capturar

Consentimiento documentado ANTES de capturar cualquier dato. Tabla `user_consents` con timestamp, tipo, y texto exacto mostrado. Si el primer mensaje es un audio con datos útiles: procesarlo como dato provisional, pedir consentimiento inmediatamente después, borrar si no acepta.

### P7. Ninguna acción irreversible sin aprobación humana

El agente informa, no ordena. En H0-H1 opera en niveles de autonomía 2-3 (colaborador/consultor). DELETE en producción, envío de mensajes que modifiquen datos, cambio de consentimiento — todo requiere confirmación explícita.

---

## CAPA 2 — Criterios de evaluación

> Estos criterios definen qué debe cumplir cualquier herramienta que usemos. Si una herramienta deja de cumplirlos, se reemplaza. Claude Code puede proponer cambios de herramienta justificando contra estos criterios — nunca contra el nombre de la herramienta anterior.

### CR1. Base de datos

- PostGIS para geolocalización EUDR (polígonos con 6 dígitos decimales)
- JSONB para datos semi-estructurados (`datos_evento` varía por tipo)
- Auth integrado o compatible (onboarding via WhatsApp)
- Row Level Security o equivalente para aislamiento por finca
- Costo < $80/mes a 100 fincas activas
- Hosted/managed (equipo de 1-2 personas)

### CR2. Servicio backend (orquestador)

- Recibir webhooks HTTP de WhatsApp Business API con respuesta <1s
- Llamadas a APIs externas (LLM, STT, WhatsApp Meta Cloud API)
- Manejo de errores con retry, dead-letter y logging estructurado
- Lógica de negocio testeable (unit + integration tests)
- Estado conversacional manejable (lectura de Supabase en <100ms)
- Deploy desde GitHub sin downtime
- Costo < $10/mes en H0

### CR3. Modelo LLM de texto

- Español latinoamericano con jerga agrícola
- Extracción de entidades a JSON con field-level accuracy ≥85%
- System prompts largos con reglas de dominio
- Latencia < 5 segundos para ~600 tokens input
- Costo < $0.15/finca/mes a 480 eventos/finca/mes
- API estable con buena documentación

### CR4. Modelo STT

- WER < 25% en español LATAM con jerga agrícola, ruido ambiental, y cortes de señal
- Soporte para .opus (formato WhatsApp)
- Latencia < 10 segundos para audios de 45 segundos
- Vocabulario personalizable o post-corrección viable con LLM
- Costo < $1.50/finca/mes (360 min audio/finca/mes)

### CR5. Sistema de observabilidad

- Trazabilidad de cada llamada LLM y STT: input, output, latencia, costo
- Soporte para datasets de evaluación (eval_dataset + eval_results)
- Costo < $10/mes en H0 (self-hosted aceptable)

### CR6. Canal de mensajería

- Business API oficial (no scrapers)
- Texto, audio (.opus), imagen
- Templates para mensajes proactivos fuera de ventana 24h
- Webhook configurable
- Pricing transparente por mensaje/template

---

## CAPA 3 — Decisiones actuales

> Estas son las herramientas que usamos HOY porque cumplen los criterios de la Capa 2. Cada decisión tiene fecha, justificación, y condición concreta de revisión. Claude Code puede proponer cambios — el debate es contra los criterios, no contra la herramienta.

### D1. Base de datos: Supabase (Plan Pro)

- **Fecha:** Abril 2026
- **Cumple:** CR1 completo — PostGIS, JSONB, Auth, RLS, $25/mes, managed.
- **Revisar cuando:** Volumen >8GB DB o >250GB storage, o necesidad de graph queries. Estimado: >100 fincas.

### D2. Servicio backend: Hono (TypeScript) en Railway

- **Fecha:** Abril 2026
- **Reemplaza:** n8n — descartado porque la lógica de negocio de Wasagro (estado conversacional, scoring de confianza, routing por tipo de evento, integración LangFuse) no es orquestable limpiamente en nodos visuales. Cualquier lógica no trivial terminaba como código TypeScript dentro de n8n sin poder testearse.
- **Cumple:** CR2 completo — webhook directo, TypeScript nativo, retry manejable en código, deploy desde GitHub, ~$5/mes en Railway Starter.
- **Stack:** Hono + TypeScript + Zod (validación de payloads) + Railway (hosting).
- **Ventajas concretas:** lógica testeable con Vitest, diff legible en git, LangFuse SDK directo, estado conversacional como query a Supabase.
- **Revisar cuando:** Volumen requiera workers distribuidos o colas de mensajes (>500 eventos/día). Alternativa: Inngest (añade queue + retry declarativo sin reemplazar el código).

### D3. LLM de texto: Router multi-modelo (Gemini + Groq)

- **Fecha:** Abril 2026 (actualizado — reemplaza GPT-4o Mini para TODO)
- **Dolor que motivó el cambio:** GPT-4o Mini fue la decisión inicial de papel. Las primeras pruebas revelaron tres problemas concretos: (1) latencia de 4-6s en texto → violaba P3, (2) sin soporte nativo multimodal para imágenes de campo, (3) costo en scale > lo proyectado para B2B enterprise.
- **Decisión:** Router tiered con dos modelos validados en H0-R:
  - **Tier fast** → `gemini-2.5-flash` (Gemini) + `llama-3.3-70b-versatile` (Groq): extracción simple, clasificación de tipo de mensaje, acuse de recibo. Latencia < 1s.
  - **Tier reasoning** → `gemini-2.5-flash` (Gemini): reflexión profunda, análisis multi-intento. La razón de usar flash también aquí es cuota: 2.5 Pro supera límites gratuitos rápidamente.
  - **Tier ultra** → `gemini-2.5-flash` (Gemini) + Minimax + Gemma-4 (NVIDIA): casos críticos, V2VK con imagen. Gemini es el único con soporte multimodal nativo en el pool.
- **Por qué no GPT-4o Mini:** OpenAI no está en el router activo. Sin multimodal para imágenes vía URL no autenticada (problema de CDN WhatsApp), y el costo por finca no justifica mantener dos proveedores de pago en H0-R con Gemini cubriendo todo el espectro.
- **Implementación:** `src/integrations/llm/LLMRouter.ts` + `src/integrations/llm/index.ts`. Variable de entorno `WASAGRO_LLM=auto` activa el router. Pool se construye con las API keys disponibles en Railway.
- **Cumple:** CR3 — español LATAM, JSON extraction, latencia < 2s (fast), soporte multimodal (ultra).
- **Revisar cuando:** Field-level accuracy en evals < 85%. Si Groq supera cuota diaria en prod, añadir fallback a Gemini en tier fast (ya está en el pool). Si llega H1, re-evaluar OpenAI para reasoning con datos de accuracy reales.

### D7. Pipeline de clasificación de imágenes antes del diagnóstico

- **Fecha:** Abril 2026
- **Dolor que motivó la decisión:** Un colega envió una foto de un racimo con trips. El sistema intentó diagnosticar directamente con V2VK y falló porque no había RAG histórico. Peor aún: cuando se enviaba una foto de un formulario de campo (planilla de cosecha manuscrita), el sistema intentaba diagnosticar una "plaga" en el documento. No había distinción entre "imagen de problema agrícola" e "imagen de documento con datos".
- **Decisión:** Clasificar TODA imagen antes de rutear. Tres categorías:
  - `plaga_cultivo` → V2VK (descripción visual → diagnóstico agronómico)
  - `documento_tabla` → OCR estructurado (extrae `registros[]` en JSON para persistencia)
  - `otro` → descarte con mensaje explicativo al usuario
- **Implementación:** `prompts/sp-03c-clasificador-imagen.md` + `prompts/sp-03d-ocr-documento.md`. Handler en `src/pipeline/handlers/EventHandler.ts` — función `resolverMediaImagen()` resuelve el base64, luego `clasificarTipoImagen()` enruta.
- **Métodos en IWasagroLLM:** `clasificarTipoImagen(base64, mimeType, traceId)` y `extraerDocumentoOCR(base64, mimeType, contexto, traceId)`.
- **Cumple:** CR3 (extracción JSON), CR5 (LangFuse en ambos paths). Previene diagnósticos absurdos y aprovecha datos de campo que antes se perdían.
- **Revisar cuando:** Accuracy del clasificador < 90% en imágenes ambiguas. Considerar añadir `recibo_de_pago` como cuarta categoría si agricultores empiezan a enviar comprobantes de compra de insumos.

### D11. Enrutador Visual Dinámico — tier OCR dedicado con DeepSeek-OCR

- **Fecha:** Abril 2026
- **Reemplaza:** D7 (parcialmente) — D7 introdujo la clasificación visual pero ejecutaba AMBOS paths (clasificador + OCR) con `modelClass: 'ultra'` (Gemini Pro). Usar el mismo modelo generalista para diagnosticar roya y para leer planillas arrugadas es un antipatrón: el modelo no está optimizado para compresión óptica de documentos manuscritos, y la latencia/costo son innecesarios para la clasificación.
- **Dolor que motivó la decisión:** El clasificador `sp-03c` y el OCR `sp-03d` ambos usaban `modelClass: 'ultra'` (Gemini 1.5 Pro). Para clasificar si una imagen es plaga o documento, un modelo fast basta. Para leer números manuscritos en papel arrugado, se necesita un modelo con compresión óptica especializada (DeepSeek-OCR / InternVL 3.0). Gemini Pro no domina box-free parsing ni handwritten OCR industrial.
- **Decisión:**
  1. **Nuevo `ModelClass: 'ocr'`** en `ILLMAdapter` — tier dedicado para procesamiento de documentos. No es `ultra` (multimodal generalista), no es `fast` (texto plano). Es un contrato distinto que recibe imagen y devuelve JSON estructurado con guardrails Zod.
  2. **Clasificador baja a `fast`** — `clasificarTipoImagen()` usa `modelClass: 'fast'` (Gemini Flash / Groq). Latencia <1s, costo 10x menor.
  3. **OCR usa `ocr` tier** — `extraerDocumentoOCR()` usa `modelClass: 'ocr'` que enruta a DeepSeek-OCR (vía NVIDIA API) o InternVL 3.0 como fallback.
  4. **Guardrails de salida Zod** — `ResultadoOCRSchema` valida TODO campo del output antes de persistir. Si el modelo devuelve `"20 usd"` donde se espera un número, Zod lo intercepta y marca como `requires_review` en vez de crashear la inserción en Supabase.
  5. **Fallback graceful** — Si el tier `ocr` no tiene adapters configurados (sin NVIDIA_API_KEY), el router hace fallback a `ultra` (Gemini Pro) con warning en logs.
- **Implementación:** `src/integrations/llm/ILLMAdapter.ts` (ModelClass extendido), `src/integrations/llm/NvidiaAdapter.ts` (reutilizado para DeepSeek-OCR vía NVIDIA API), `src/integrations/llm/index.ts` (pool config con tier `ocr`), `src/types/dominio/OCR.ts` (ResultadoOCRSchema), `prompts/sp-03d-ocr-documento.md` (reescrito para OCR especializado), `src/integrations/llm/WasagroAIAgent.ts` (modelClass actualizados).
- **Cumple:** CR3 (JSON extraction con validación Zod <10ms), CR5 (LangFuse en ambos paths), D3 (router tiered), AGENTS.md Regla 1 (no inventar datos — Zod bloquea formatos incorrectos).
- **Pool OCR activo (Mayo 2026):** Nemotron-OCR-v1 (`nvidia/nemotron-ocr-v1`, temp=0, top_p=0.1, max_tokens=8192) como modelo primario; Kimi-K2.6 (`moonshotai/kimi-k2.6`, max_tokens=16384, thinking=true) como segundo; DeepSeek-OCR (`deepseek-ai/deepseek-ocr-v2`) y InternVL 3.0 como fallbacks. Nemotron y Kimi se añadieron por su especialización en box-free parsing — DeepSeek-OCR era la única opción y tenía timeouts frecuentes en documentos densos.
- **Loop de auto-corrección (Mayo 2026):** Si Zod rechaza el output del modelo, se reintenta hasta MAX_OCR_RETRIES=2 pasando los errores específicos + imagen nuevamente. Si se agotan los intentos, `construirFallbackOCR()` aplica coerción determinista + marca como requires_review. LangFuse events: `ocr_zod_retry`, `ocr_zod_exhausted`.
- **Revisar cuando:** Field-level accuracy en OCR < 85%. Si InternVL 3.0 supera a DeepSeek-OCR en benchmarks de handwritten, hacer swap. Si se añade `recibo_de_pago` a TipoImagen, necesita su propio prompt y schema de validación.

### D8. Descarga de media de Evolution API como base64

- **Fecha:** Abril 2026
- **Dolor que motivó la decisión:** Evolution API envía webhooks con URLs de media de WhatsApp CDN (`media.cdn.whatsapp.net`). Estas URLs requieren autenticación Bearer que solo tiene Evolution API. Cuando GeminiAdapter intentaba `fetch(imageUrl)` directamente para pasarla al LLM, recibía 401/403. TODA imagen enviada al sistema fallaba silenciosamente y se guardaba como `nota_libre` con `status: requires_review`. El agricultor jamás recibía un diagnóstico — solo silencio.
- **Decisión:** Nunca pasar la URL de CDN al LLM. En cambio, descargar el media como base64 usando el endpoint de Evolution API (`/chat/getBase64FromMediaMessage/:instance`) y pasar `imageBase64` + `imageMimeType` directamente al adapter.
- **Implementación:** `src/integrations/whatsapp/EvolutionMediaClient.ts` — función `downloadEvolutionMedia(rawPayload, apiUrl, apiKey, instance)`. `NormalizedMessage` ahora incluye `mediaBase64` y `mediaMimetype`. `GeminiAdapter` tiene path separado: si `opciones.imageBase64` existe, usa `inlineData` directamente; si solo tiene `imageUrl`, usa fetch como fallback.
- **Variables requeridas en Railway:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`.
- **Revisar cuando:** Se migre a Meta Cloud API en H1 (sus URLs de media tienen autenticación diferente — requeriría token de Meta, no de Evolution).

### D9. Extracción multi-intento para mensajes compuestos

- **Fecha:** Abril 2026
- **Dolor que motivó la decisión:** Un agricultor decía: "Apliqué Entrust, gasté $20, me sobró 1 litro". El sistema trataba el mensaje como un único evento. Si el clasificador lo mapeaba a `aplicacion_insumo`, se perdía el dato de gasto. Si lo mapeaba a `nota_economica`, se perdía la aplicación. Un mensaje = muchos datos = pérdida garantizada con extractor monolítico.
- **Decisión:** `WasagroAIAgent.extraerEventos()` clasifica primero la intención del mensaje (puede ser múltiple), luego ejecuta extractores especializados por cada intención detectada. El resultado es `ExtraccionMultiEvento` con array de eventos independientes.
- **Implementación:** `src/integrations/llm/WasagroAIAgent.ts`. Clasificador usa tier `fast`. Extractores especializados en paralelo con `Promise.all`. `sp-01a-extractor-insumo.md` ahora incluye campos `cantidad_sobrante` y `unidad_sobrante`.
- **Limitación actual:** El clasificador puede fallar en mensajes con más de 3 intenciones simultáneas. En ese caso, el sistema registra lo que puede y marca el raw como `requires_review` (P1 — nunca inventar, P2 — máx 2 preguntas).
- **Revisar cuando:** Se detecten en LangFuse mensajes con > 2 intenciones que se pierdan. Próxima iteración: extractores en paralelo con merge de confianza.
- **REEMPLAZADO POR D10** — El `Promise.all` en línea fue eliminado en favor del patrón Initiator-Sub-Agent con pg-boss por intención.

### D10. Patrón Initiator-Sub-Agent con pg-boss por intención

- **Fecha:** Abril 2026
- **Reemplaza:** D9 (Promise.all en línea) — El `Promise.all` dentro de un solo job de pg-boss perdía TODOS los resultados si Railway reiniciaba el proceso, incluyendo los que ya habían completado.
- **Dolor que motivó la decisión:** Un reinicio de Railway mataba el job de pg-boss mientras 3 extractores corrían en paralelo. Si el extractor de "gasto" ya había guardado su resultado pero el de "aplicación" no, se perdía TODO — el gasto ya persistido se quedaba huérfano sin confirmación al agricultor. Además, 3 intenciones paralelas sin control de concurrencia podían saturar las APIs de IA con errores 429 en cascada.
- **Decisión:** Desacoplar clasificación de ejecución:
  1. **IntentGate (Agente Iniciador):** Modelo Tier fast clasifica el mensaje y devuelve array de intenciones. No ejecuta extracción.
  2. **Encolamiento por intención:** Cada intención se encola como job independiente en pg-boss (`procesar-intencion`). Cada job tiene su propio retry budget.
  3. **Worker por intención (Sub-agente):** Cada worker ejecuta `#extraerEspecializado` para un solo tipo, guarda checkpoint en Supabase, marca la intención como completada en la sesión.
  4. **Coordinación en sesión:** Array `intenciones_pendientes` en `sesiones_activas.contexto_parcial`. Cuando todas completan → confirmación al agricultor.
  5. **WAIT-CAP-STOP:** 429 → exponential backoff con `Retry-After` (WAIT). Múltiples 429s → reducir `maxThreads` (CAP). 5+ 429s consecutivos → abortar job (STOP). pg-boss reintentará automáticamente.
- **Implementación:** `src/integrations/llm/IntentGate.ts`, `src/workers/pgBoss.ts` (worker `procesar-intencion`), `src/pipeline/handlers/EventHandler.ts` (encolamiento), `src/pipeline/supabaseQueries.ts` (coord. funciones), `src/types/dominio/EventoCampo.ts` (tipos). ADR: `docs/decisions/006-initiator-sub-agent-pg-boss.md`.
- **Resultado:** Si Railway mata el proceso mientras el worker de "gasto" se ejecuta, pg-boss solo reintenta la tarea de "gasto". La tarea de "aplicación" que terminó milisegundos antes y guardó su estado queda intacta.
- **Revisar cuando:** Latencia del IntentGate > 2s (debería ser <1s con Tier fast). Errores de coordinación en sesión cuando >5 intenciones simultáneas (edge case extremo).

### D4. STT: Deepgram nova-2-general

- **Fecha:** Mayo 2026 (actualizado — reemplaza GPT-4o Mini Transcribe)
- **Reemplaza:** GPT-4o Mini Transcribe (OpenAI). La decisión inicial fue de papel — en H0-R se consiguió acceso al API de Deepgram, que resuelve tres limitaciones concretas de OpenAI Transcribe: (1) soporte nativo `.opus` sin conversión previa, (2) modo `language: 'multi'` para español LATAM + inglés mezclado en un mismo audio, (3) integración directa con Buffer en memoria sin archivo temporal en disco.
- **Modelo activo:** `nova-2-general` con `language: 'multi'`, `smart_format: true`.
- **Cumple:** CR4 parcial — $0.0043/min, `.opus` nativo, latencia <5s para 45s de audio, vocabulario personalizable. WER en campo no validado aún (H-TEC-02 pendiente).
- **Implementación:** `src/pipeline/sttService.ts`. Variable requerida: `DEEPGRAM_API_KEY` en Railway. SDK: `@deepgram/sdk` v5 — `client.listen.v1.media.transcribeFile(buffer, options)`. Respuesta es `HttpResponsePromise<ListenV1Response | ListenV1AcceptedResponse>` → acceder via `.data.results`.
- **Revisar cuando:** Resultados de H-TEC-02 (20 audios, 4 modelos). Si Voxtral demuestra WER superior en español agrícola LATAM, migrar. Si `nova-3` mejora accuracy sin incremento significativo de costo, actualizar modelo.

### D5. Observabilidad: LangFuse self-hosted

- **Fecha:** Abril 2026
- **Cumple:** CR5 — trazabilidad completa, evals, $0/mes (Postgres compartido con Supabase).
- **Revisar cuando:** Volumen de traces sature el Postgres compartido. Alternativa: LangFuse Cloud (free tier 50K traces/mes).

### D12. RAG contextual + Embeddings semánticos para diagnóstico agrícola

- **Fecha:** Mayo 2026
- **Problema que motivó la decisión:** El diagnóstico de plagas (V2VK) y la extracción multi-intento operaban sin memoria histórica. Un colega enviaba una foto de trips — el sistema no podía saber si esa misma finca había reportado la misma plaga la semana anterior, si ya se había aplicado un insumo específico, o qué cultivo tiene ese lote. Sin contexto histórico, el diagnóstico era genérico e ignoraba patrones de la finca.
- **Decisión:** Dos mecanismos paralelos de contexto:
  1. **Embeddings por evento:** Cada evento de campo confirmado se convierte en embedding semántico (`svc.generarEmbedding(descripcion_raw)`) y se persiste via `guardarEmbeddingEnEvento`. Esto construye una memoria vectorial de la finca a lo largo del tiempo.
  2. **RAG retrieval en tiempo real:** Antes de la extracción de intenciones (texto) y antes del diagnóstico V2VK (imagen), se recuperan los N eventos más similares de la finca (`_ragRetriever.recuperarContexto(finca_id, query)`). El contexto recuperado se inyecta en el prompt del LLM.
- **Implementación:** `src/integrations/llm/EmbeddingService.ts` (`IEmbeddingService`), `src/pipeline/supabaseQueries.ts` (`guardarEmbeddingEnEvento`), `src/pipeline/handlers/EventHandler.ts` (RAG en paths de texto e imagen). Variables: embedding model via `_embeddingService` singleton.
- **Por qué no esperar:** El costo de NO tener contexto histórico en H0-R es falsos negativos en plagas recurrentes y preguntas de clarificación innecesarias sobre datos que ya están en el sistema.
- **Revisar cuando:** Latencia de RAG retrieval > 1s en producción (actualmente <300ms en Supabase pgvector). Si el volumen de eventos supera 10K por finca, evaluar índice HNSW dedicado. Si `_ragRetriever` devuelve context irrelevante frecuentemente (>20% de queries), ajustar similarity threshold.

### D17. Acceso live a Supabase durante el loop ReAct de extracción

- **Fecha:** Mayo 2026
- **Problema que motivó la decisión:** El extractor de intenciones necesitaba resolver ambigüedades (lotes con nombres coloquiales, productos en inventario) sin preguntar al agricultor. Sin datos reales, la única opción era marcar como `requiere_clarificacion` o inventar el `lote_id` — ambas inaceptables (P1, P2).
- **Decisión:** El LLM tiene acceso durante el ReAct loop a un conjunto fijo y cerrado de herramientas de solo lectura contra Supabase: `obtener_lotes_finca` y `consultar_inventario_insumos`. El `finca_id` siempre se inyecta desde el contexto del usuario — el LLM no puede consultar datos de otra finca. Doom-loop guard detecta llamadas repetidas a la misma herramienta con los mismos args y fuerza la extracción final.
- **Implementación:** `src/agents/mcp/SupabaseTools.ts` (definición de herramientas), `src/integrations/llm/WasagroAIAgent.ts` (`#extraerEspecializado` — loop ReAct con tool dispatch). ADR: `docs/decisions/008-react-supabase-live-query.md`.
- **Guardrails activos:** Solo SELECT, scoped por `finca_id`, conjunto cerrado, doom-loop guard, LangFuse events en cada tool call y cada error.
- **Revisar cuando:** Latencia de queries supera 500ms en producción. Si se necesita agregar una nueva herramienta, requiere actualización del prompt del extractor + evaluación de impacto en latencia.

### D16. Onboarding conversacional de admin y agricultor

- **Fecha:** Abril 2026
- **Problema que motivó la decisión:** El sistema necesita identificar quién es el usuario antes de procesar eventos. Un número de WhatsApp nuevo puede ser el administrador de la exportadora configurando la finca, o un trabajador de campo reportando por primera vez. Sin un flujo de onboarding guiado, el sistema no tiene finca_id, lote_id ni rol para procesar ningún mensaje.
- **Decisión:** Dos flujos conversacionales independientes según el rol detectado:
  1. **`onboardarAdmin`** — Guía al administrador para registrar la finca (nombre, cultivo, país, lotes). Prompt `sp-02a-onboarding-admin.md`. Usa `modelClass: 'fast'` — es diálogo estructurado, no razonamiento complejo.
  2. **`onboardarAgricultor`** — Guía al trabajador de campo para registrarse (nombre, finca asignada). Prompt `sp-02b-onboarding-agricultor.md`. Usa `modelClass: 'fast'`.
  Ambos flujos retornan `RespuestaOnboarding` validada con `RespuestaOnboardingSchema` (Zod). El estado conversacional se mantiene en `sesiones_activas.contexto_parcial` en Supabase (D1).
- **Implementación:** `src/integrations/llm/WasagroAIAgent.ts` — métodos `onboardarAdmin`, `onboardarAgricultor`. Handlers: `src/pipeline/handlers/OnboardingHandler.ts`.
- **Revisar cuando:** Se implemente login via OTP para admin (reduce dependencia del flujo conversacional). Si >30% de sesiones de onboarding quedan incompletas después de 2 intercambios, revisar la longitud del flujo.

### D13. SDR — Pipeline de ventas via WhatsApp

- **Fecha:** Mayo 2026
- **Problema que motivó la decisión:** El equipo necesitaba demostrar Wasagro a exportadoras potenciales. El canal natural es WhatsApp (mismo que usan los agricultores), pero el flujo de prospecting/ventas es completamente distinto al flujo de captura de campo: el interlocutor es un ejecutivo, no un trabajador; el objetivo es calificar y convertir, no estructurar datos agronómicos.
- **Decisión:** Pipeline SDR independiente del pipeline de campo, activado por número de WhatsApp diferenciado o por flag en la sesión. Tres fases: (1) `atenderProspecto` — saludo y calificación con `sp-00-prospecto.md`; (2) `extraerDatosSDR` — extracción de empresa/cultivo/hectáreas/problema con `SP-SDR-02-extractor.md`; (3) `redactarMensajeSDR` — propuesta personalizada con `SP-SDR-03-writer.md`. Usa `modelClass: 'fast'` para latencia mínima.
- **Implementación:** `src/integrations/llm/WasagroAIAgent.ts` — métodos `atenderProspecto`, `extraerDatosSDR`, `redactarMensajeSDR`. Prompts en `prompts/sp-00-prospecto.md`, `prompts/SP-SDR-02-extractor.md`, `prompts/SP-SDR-03-writer.md`.
- **Revisar cuando:** Se construya CRM propio. Si el volumen de prospectos supera 50/mes, evaluar Inngest para queue de follow-ups automáticos.

### D14. Resumen semanal por finca

- **Fecha:** Mayo 2026
- **Problema que motivó la decisión:** Las exportadoras necesitan visibilidad semanal consolidada de la actividad de cada finca — insumos aplicados, costos acumulados, plagas detectadas, eventos pendientes de revisión. Sin esto, el valor de Wasagro no es visible para quien paga.
- **Decisión:** Generación de resumen estructurado por finca a partir de los eventos de la semana. El método `resumirSemana(fincaId, eventos, traceId)` toma el array de eventos del periodo y genera un JSON con secciones: actividades, alertas, costos, recomendaciones. Usa `modelClass: 'reasoning'` porque requiere síntesis de múltiples eventos con inferencia de prioridades.
- **Implementación:** `src/integrations/llm/WasagroAIAgent.ts` — método `resumirSemana`. Prompt: `prompts/sp-05-resumen-semanal.md`.
- **Revisar cuando:** Si el resumen se envía proactivamente (fuera de ventana 24h de WhatsApp), requiere templates de Meta (D6). Considerar schedule via pg-boss para envío automático cada lunes.

### D15. Clasificación y normalización de archivos Excel

- **Fecha:** Mayo 2026
- **Problema que motivó la decisión:** Algunas fincas llevan registros en planillas Excel (cosecha, aplicaciones, inventario). En lugar de obligarlas a reentrar datos manualmente por WhatsApp, Wasagro debe poder ingerir estos archivos directamente.
- **Decisión:** `clasificarExcel(contenidoTexto, traceId)` recibe el contenido textual extraído de un Excel (columnas + filas como texto) y devuelve el tipo de planilla detectado y los registros normalizados al mismo formato que produce el OCR de documentos (`ResultadoOCR`). Usa `modelClass: 'fast'` — el texto ya está estructurado, no requiere visión. Prompt: `sp-06-clasificar-excel.md`.
- **Implementación:** `src/integrations/llm/WasagroAIAgent.ts` — método `clasificarExcel`. El canal WhatsApp puede recibir documentos `.xlsx` vía Evolution API (D6); la extracción de texto del Excel es pre-procesada antes de llamar al método.
- **Revisar cuando:** Si agricultores empiezan a enviar PDFs (planillas escaneadas), el path correcto es OCR (D11), no este método. Si el volumen de Excels supera 100/semana por finca, evaluar procesamiento batch offline.

### D6. Canal: WhatsApp Business API — Evolution API (self-hosted)

- **Fecha:** Abril 2026 (actualizado desde Meta Cloud API directo — ver ADR 002)
- **Cumple:** CR6 completo — API oficial via Baileys, multimodal, webhooks configurables.
- **H0:** Evolution API self-hosted en Railway — reemplaza Meta Cloud API porque el acceso a Meta Developer no estaba disponible para el equipo en H0. El servicio Hono recibe el webhook de Evolution en `POST /webhook/whatsapp` vía `EvolutionAdapter`. Instancia: `wasagro-prod` en `evolution-api-production-8ba4.up.railway.app`.
- **Revisar cuando:** Meta Developer esté accesible para migrar a API oficial en H1 (phone_number_id y WABA_ID portables). BSP alternativo: 360Dialog o Wati.

---

## Estructura del repo

Repo único: `Agrow7-code/Wasagro`

```
Wasagro/
├── CLAUDE.md                        ← Steering para Claude Code
├── AGENTS.md                        ← Guardrails GGA
├── src/
│   ├── webhook/                     ← Handler WhatsApp (recibe, valida, despacha)
│   ├── pipeline/                    ← STT → LLM → extracción → Supabase
│   ├── agents/                      ← Lógica conversacional, estado, scoring
│   ├── integrations/                ← OpenAI, Supabase, Meta API, LangFuse
│   └── types/                       ← Zod schemas + TypeScript types
├── supabase/
│   └── migrations/                  ← SQL numeradas (01-schema-core.sql, etc.)
├── prompts/                         ← System prompts del agente Wasagro
├── docs/
│   ├── 01-problema-y-contexto.md
│   ├── 02-arquitectura.md
│   └── decisions/                   ← ADRs (Architecture Decision Records)
│ ├── 001-hono-over-n8n.md
│ ├── 002-evolution-api-over-meta.md
│ ├── 003-image-classifier-before-v2vk.md ← D7
│ ├── 004-evolution-media-download-as-base64.md ← D8
│ ├── 005-multi-intent-extraction.md ← D9
│ └── 006-initiator-sub-agent-pg-boss.md ← D10 (reemplaza D9)
└── tests/
```

## Convenciones de código

### SQL

- Tablas en español snake_case: `eventos_campo`, `user_consents`
- UUIDs como PK (excepto `finca_id`/`lote_id`: TEXT F001, F001-L01)
- JSONB para `datos_evento`
- PostGIS para `coordenadas` (POINT) y `poligono` (POLYGON)
- Migraciones numeradas: `02-patch-consents.sql`

### Prompts del agente

- Voz y Tono: Notion → Sección 04
- Vocabulario prohibido: "base de datos", "JSON", "tipo de evento", "sistema", "plataforma", "registrado exitosamente", "reformular"
- Tuteo Ecuador/Guatemala. Máx 3 líneas. Emojis solo ✅ ⚠️.

### Servicio backend (Hono/TypeScript)

- Un handler por caso de uso en `src/pipeline/`
- Nombres de funciones en español descriptivo: `procesarReporteVoz`, `onboardarFinca`
- Toda lógica de negocio tiene test unitario en `tests/`
- Nunca lógica en el handler del webhook — solo recibir, validar con Zod, despachar

## Glosario de campo

| Término | Significado | Conversión |
|---|---|---|
| Bombada | Tanque de 20L aspersora | 1 bombada = 20L |
| Caneca | Recipiente grande | ~100L |
| Quintal / qq | Unidad de peso | 1 qq = 45.4 kg |
| Jornal | 1 persona × 1 día | Mano de obra |
| Colino | Hijo/rebrote de planta | Conteo por mata |
| Escoba | Foco de Moniliophthora | Enfermedad cacao |
| Helada | Alta incidencia moniliasis | No = clima frío |
| Riel | Cable aéreo empacadora | Cajas banano |
| Mazorca negra | Fruto cacao enfermo | Clasificar plaga |
| Rechazo | Fruta no exportable | Porcentaje |
| Brix | Grados madurez | Número |

## Al inicio de cada sesión

1. Leer este archivo (automático)
2. `mem_search` en engram para decisiones recientes
3. Si necesitas contexto de Notion, leer via MCP (no copiar)
4. Preguntar: "¿Qué vamos a construir hoy?" — no asumir

## Gobernanza — Reglas de sincronización

### Qué va a cada sistema

| Tipo de cambio | GitHub | Notion | Engram |
|---|---|---|---|
| Código nuevo / modificado | commit | — | si decisión no-obvia |
| Schema SQL | migration numerada | — | — |
| Decisión de arquitectura | `docs/decisions/NNN-titulo.md` | referencia al ADR | mem_save |
| Cambio en system prompt | `prompts/` | — | — |
| Hipótesis de producto nueva | — | crear página | — |
| Resultado de validación H0 | — | actualizar hipótesis | mem_save si aprendizaje técnico |
| Bug fix no-obvio | fix + commit | — | mem_save con root cause |

### Sincronización al completar cada tarea

1. `git add [archivos específicos] && git commit && git push origin main`
2. Si afecta arquitectura: crear o actualizar ADR en `docs/decisions/`
3. Si afecta documentación de producto para stakeholders: actualizar Notion vía MCP
4. Al final de cada página de Notion actualizada: `🤖 Actualizado por Claude Code — [fecha]`
5. Si se tomó una decisión técnica importante: `mem_save` en Engram

### ADR — Architecture Decision Records

Cada decisión técnica importante que reemplaza algo anterior requiere un ADR en `docs/decisions/`:

```markdown
# NNN — Título de la decisión

**Fecha:** YYYY-MM-DD
**Estado:** Aceptada | Reemplazada por NNN+1

## Contexto
Por qué surgió esta decisión.

## Decisión
Qué se decidió hacer.

## Consecuencias
Qué cambia, qué se gana, qué se pierde.
```

El primer ADR pendiente: `001-hono-over-n8n.md`.
