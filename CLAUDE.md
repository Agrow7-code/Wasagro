# Wasagro — CLAUDE.md

> Cerebro del proyecto para Claude Code. Tres capas: principios invariantes, criterios que toda herramienta debe cumplir, y decisiones vigentes. El **porqué histórico** de cada decisión vive en su ADR (`docs/decisions/`), no acá — este archivo es steering, no changelog.

## Identidad del proyecto

Wasagro es un sistema operativo de campo agrícola AI-first. Captura datos en fincas de exportación (cacao/banano) en Ecuador/Guatemala via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

- **Horizonte actual: H0-R → producción.** Wasagro **dejó de ser MVP**: está recibiendo prospectos reales y en conversaciones comerciales activas. El estándar es **production-readiness**, no "mínimo viable" — flujos, procesos, diseño y arquitectura a la altura de recibir clientes pagantes. Postura completa y backlog: Engram `wasagro/production-readiness-posture` + auditoría `wasagro/readiness-audit`.
- **Estándar de entrega (no-MVP):** ningún cliente/prospecto ve datos **mock** (vista no migrada → tras flag `demo` o no se muestra); cada cambio se entrega **production-grade** (aislamiento cross-tenant D31, datos reales, tests, P4). "Anda en la demo" ≠ listo.
- **Métrica Norte:** eventos de campo correctamente estructurados por semana por finca activa (accuracy ≥ 85%).
- **Modelo de negocio:** B2B enterprise — exportadora paga, agricultor usa gratis.
- **Por qué:** H0 (escrito sin probar) no creaba valor; H0-R entregó producto que funciona en campo. Hoy, con prospectos activos, el foco es estar **LISTOS para clientes reales** — el problema ya está confirmado, no se "valida" más.

## SSOT — Dónde vive cada cosa

| Capa | Herramienta | Qué vive ahí | Audiencia |
|---|---|---|---|
| Producto (qué, por qué, para quién) | **Notion** | Manual Maestro, hipótesis H0, pipeline ventas, notas de campo, user research | Stakeholders, exportadoras, no-técnicos |
| Técnica (cómo, qué se construyó) | **GitHub: Agrow7-code/Wasagro** | Schema SQL, código TS, prompts, arquitectura, ADRs | Ingenieros, Claude Code |
| Steering de desarrollo | **CLAUDE.md** (este archivo) | Principios, criterios, decisiones vigentes | Claude Code al inicio de sesión |
| Code review | **AGENTS.md** | Guardrails que GGA verifica en cada commit | GGA pre-commit |
| Memoria persistente | **Engram** | Decisiones, bugs, aprendizajes entre sesiones | Claude Code entre sesiones |

**Regla anti-silo (CRÍTICA):** un dato vive en UN solo sistema. Lo lee un no-técnico → Notion. Lo lee un ingeniero/Claude → GitHub. Continuidad entre sesiones → Engram. **Nunca duplicar.** Si está en GitHub, los demás referencian el link, no copian el contenido.

**Repos:** `Agrow7-code/Wasagro` es el único activo. `Agrow7-code/wasagro-architecture` está **ARCHIVADO** (no recibe más commits).

---

## CAPA 1 — Principios invariantes

> Independientes de cualquier herramienta o proveedor. Si una decisión técnica viola un principio, se cambia la decisión, no el principio.

### P1. El agente nunca inventa datos
Si no tiene información, pregunta. Si no puede extraer un campo, lo marca `null` con `confidence_score` bajo. Jamás fabrica un lote, una dosis, o un producto. Una asunción incorrecta en agricultura puede causar daño económico real e irreversible.

### P2. Máximo 2 preguntas de clarificación
Después de 2 preguntas sin completar, registrar como `nota_libre` con `status='requires_review'`. El rendimiento de LLMs cae 39% en conversaciones multi-turno. No torturar al usuario con preguntas.

### P3. Latencia < 30 segundos
Acuse de recibo en <5s. Respuesta estructurada completa en <30s. Si el pipeline tarda más, enviar "Estoy procesando tu reporte..." de inmediato. Un trabajador que camina al siguiente lote tiene 30-60s de ventana de atención.

### P4. Todo error se loggea sin excepción
Toda llamada LLM, toda transcripción STT, todo error de extracción queda registrado en observabilidad: input raw, output estructurado, confidence_score, modelo, latencia. No existen catch vacíos ni errores silenciosos.

### P5. Los datos del campo pertenecen a la finca
Wasagro tiene licencia de uso, no propiedad. La exportadora solo ve lo que la finca autoriza. Ningún dato se agrega o vende sin consentimiento explícito. Todo evento conserva `descripcion_raw` junto al JSON estructurado.

### P6. Consentimiento antes de capturar
Consentimiento documentado ANTES de capturar dato alguno (`user_consents` con timestamp, tipo, texto exacto mostrado). Si el primer mensaje es audio con datos útiles: procesar como provisional, pedir consentimiento, borrar si no acepta.

### P7. Ninguna acción irreversible sin aprobación humana
El agente informa, no ordena. En H0-H1 opera en autonomía 2-3 (colaborador/consultor). DELETE en producción, mensajes que modifiquen datos, cambio de consentimiento — todo requiere confirmación explícita.

---

## CAPA 2 — Criterios de evaluación

> Definen qué debe cumplir cualquier herramienta. Si deja de cumplirlos, se reemplaza. El debate de cambio es contra el criterio, nunca contra el nombre de la herramienta anterior.

### CR1. Base de datos
PostGIS para geolocalización EUDR (polígonos, 6 decimales) · JSONB para datos semi-estructurados (`datos_evento`) · Auth integrado o compatible (onboarding WhatsApp) · RLS o equivalente para aislamiento por finca · costo < $80/mes a 100 fincas · hosted/managed.

### CR2. Servicio backend (orquestador)
Webhooks WhatsApp con respuesta <1s · llamadas a APIs externas (LLM, STT, WhatsApp) · errores con retry, dead-letter y logging estructurado · lógica testeable (unit + integration) · estado conversacional desde Supabase <100ms · deploy desde GitHub sin downtime · costo < $10/mes en H0.

### CR3. Modelo LLM de texto
Español LATAM con jerga agrícola · extracción a JSON con field-level accuracy ≥85% · system prompts largos con reglas de dominio · latencia < 5s para ~600 tokens input · costo < $0.15/finca/mes a 480 eventos/mes · API estable.

### CR4. Modelo STT
WER < 25% en español LATAM (jerga, ruido, cortes de señal) · `.opus` (formato WhatsApp) · latencia < 10s para audios de 45s · vocabulario personalizable o post-corrección con LLM · costo < $1.50/finca/mes (360 min/mes).

### CR5. Sistema de observabilidad
Trazabilidad de cada llamada LLM y STT (input, output, latencia, costo) · datasets de evaluación (eval_dataset + eval_results) · costo < $10/mes en H0 (self-hosted aceptable).

### CR6. Canal de mensajería
Business API oficial (no scrapers) · texto, audio `.opus`, imagen · templates para mensajes proactivos fuera de ventana 24h · webhook configurable · pricing transparente por mensaje/template.

---

## CAPA 3 — Decisiones vigentes (índice)

> Qué usamos HOY y cuándo revisarlo. El narrativo completo (dolor, alternativas descartadas, implementación) vive en el ADR enlazado. Las decisiones sin ADR son ligeras y se documentan solo acá. Claude Code puede proponer cambios — el debate es contra los criterios de CAPA 2.

### Infraestructura & plataforma

- **D1 — Supabase (Plan Pro):** DB del proyecto. PostGIS, JSONB, Auth, RLS, ~$25/mes, managed. *Revisar:* >8GB DB / >250GB storage / necesidad de graph queries (~>100 fincas).
- **D2 — Backend Hono + TypeScript en Railway** (reemplaza n8n). Zod para validación de payloads, retry en código, ~$5/mes. *Revisar:* >500 eventos/día → Inngest (queue + retry declarativo). [ADR 001]
- **D5 — Observabilidad LangFuse self-hosted** (Postgres compartido con Supabase, $0/mes). *Revisar:* saturación del Postgres → LangFuse Cloud (free 50K traces/mes).
- **D6 — Canal WhatsApp vía Evolution API self-hosted** en Railway (instancia `wasagro-prod`). Webhook `POST /webhook/whatsapp` vía `EvolutionAdapter`. *Revisar:* Meta Developer accesible → Meta Cloud API en H1. [ADR 002]

### LLM & pipeline de captura

- **D3 — Router LLM multi-modelo (Gemini + Groq).** Tiers: `fast` (`gemini-2.5-flash` + `llama-3.3-70b-versatile`), `reasoning` (`gemini-2.5-flash`), `ultra` (`gemini-2.5-flash` + Minimax/Gemma NVIDIA, único multimodal), `ocr` (ver D11). `WASAGRO_LLM=auto` activa el router (`src/integrations/llm/LLMRouter.ts`). Sin OpenAI en el pool activo. *Revisar:* accuracy en evals < 85%; en H1 reconsiderar OpenAI para reasoning.
- **D4 — STT Deepgram `nova-2-general`** (`language:'multi'`, `smart_format:true`). `src/pipeline/sttService.ts`, env `DEEPGRAM_API_KEY`. *Revisar:* resultados H-TEC-02; si Voxtral mejora WER agrícola o `nova-3` mejora sin sobrecosto, migrar.
- **D7 — Clasificación de imagen antes de diagnóstico.** `clasificarTipoImagen()` enruta: `plaga_cultivo`→V2VK, `documento_tabla`→OCR, `otro`→descarte (más `muestreo_sigatoka_banano`, ver D29). *Revisar:* accuracy clasificador < 90%. [ADR 003 — tier de modelos reemplazado por D11]
- **D8 — Media de Evolution como base64** (nunca la URL del CDN de WhatsApp, que da 401). `downloadEvolutionMedia()` en `EvolutionMediaClient.ts`; el adapter recibe `imageBase64` + mimeType. Env `EVOLUTION_API_URL/KEY/INSTANCE`. *Revisar:* migración a Meta Cloud API (auth de media distinta). [ADR 004]
- **D10 — Patrón Initiator-Sub-Agent con pg-boss por intención** (reemplaza el `Promise.all` en línea de D9). `IntentGate` clasifica → cada intención se encola como job independiente → worker `#extraerEspecializado` con checkpoint en Supabase → coordinación en `sesiones_activas`. WAIT-CAP-STOP ante 429. *Revisar:* latencia IntentGate > 2s; coordinación con >5 intenciones simultáneas. [ADR 006]
- **D11 — Enrutador visual: tier `ocr` dedicado.** Clasificador en `fast`; OCR en tier `ocr` con **Gemini (`gemini-2.5-flash`) primario** + NVIDIA como fallback (Nemotron/DeepSeek-OCR/InternVL — IDs actuales dan 404, a verificar; Kimi-K2.6 timeoutea). `extraerDocumentoOCR` usa `timeoutMs:35s` para completar en un intento. Salida validada por `ResultadoOCRSchema` (Zod) con auto-corrección retry×2. *Revisar:* field-level accuracy OCR < 85%; corregir IDs NVIDIA NIM. [ADR 007, actualización en ADR 013]
- **D12 — RAG contextual + embeddings por evento.** `EmbeddingService` genera embedding de cada evento confirmado (`guardarEmbeddingEnEvento`); retrieval inyecta contexto histórico antes de extracción de texto y de V2VK. *Revisar:* retrieval > 1s en prod, o >10K eventos/finca → índice HNSW dedicado.
- **D17 — Acceso live read-only a Supabase en el loop ReAct.** Conjunto cerrado: `obtener_lotes_finca`, `consultar_inventario_insumos`. Solo SELECT, scoped por `finca_id` inyectado del contexto, doom-loop guard. *Revisar:* queries > 500ms. [ADR 008]
- **D9 — Extracción multi-intento (Promise.all en línea):** *reemplazada por D10.* [ADR 005, histórico]

### Features de finca (dashboard & agente)

- **D14 — Resumen semanal por finca.** `resumirSemana(fincaId, eventos, traceId)`, tier `reasoning`. Prompt `sp-05-resumen-semanal.md`. *Revisar:* envío proactivo (fuera de 24h) → requiere templates Meta; schedule vía pg-boss los lunes.
- **D15 — Clasificación/normalización de Excel.** `clasificarExcel(contenidoTexto, traceId)` → `ResultadoOCR`, tier `fast`. *Revisar:* si llegan PDFs escaneados, el path correcto es OCR (D11), no este método.
- **D16 — Onboarding conversacional admin/agricultor.** `onboardarAdmin` / `onboardarAgricultor`, tier `fast`, estado en `sesiones_activas.contexto_parcial`. Retornan `RespuestaOnboarding` (Zod). *Revisar:* login OTP admin (D22 reduce dependencia); >30% sesiones incompletas → acortar flujo.
- **D18 — Calculadora de métricas configurable por finca.** `metricaEngine.ts` + router (9 endpoints) + UI `Calculadora.tsx`. Tres capas: `metricas_finca` (fórmula JSONB), `umbrales_metrica` (por finca), `resultados_metricas` (caché). Misma métrica, umbrales distintos por finca. *Revisar:* >10K eventos/finca → precálculo batch en pg-boss.
- **D19 — Alertas de clima por finca.** Cron diario 11:00 UTC (OpenMeteo). `alertaClima.ts`, trigger manual `POST /alertas/clima` (protegido por `REPORTE_SECRET`). *Revisar:* umbrales distintos por país → parametrizar por `pais`; outages → fallback WeatherAPI.
- **D20 — Alertas de precio de banano.** Cron semanal lunes 11:30 UTC (`BananaTradersClient`). `alertaPrecio.ts`. *Revisar:* otros cultivos → generalizar a `alertaPrecio(cultivo)`.
- **D21 — Editor de polígonos de lotes** en `/dashboard/finca/setup` (Leaflet + Esri, geocode Nominatim, RPC `insertar_lote`). Solo crear; eliminación es soft-delete; sin update de geometría para no sobreescribir EUDR (P7). *Revisar:* edición de polígono guardado → flujo de confirmación explícita.
- **D22 — Auth OTP del dashboard vía WhatsApp.** `POST /api/auth/request-otp` (código 6 dígitos, TTL 10 min) + `/verify-otp` (devuelve perfil con `finca_id`) + `GET /api/auth/me`. Solo números ya en `usuarios`. *Revisar:* logout remoto → tabla de sesiones; >100 intentos/h → rate limiting.

### SDR & ventas

- **D13 — Pipeline SDR de ventas** (independiente del de campo). `atenderProspecto` → `extraerDatosSDR` → `redactarMensajeSDR`, tier `fast`. Prompts `sp-00-prospecto.md`, `SP-SDR-02/03`. *Revisar:* CRM propio; >50 prospectos/mes → Inngest para follow-ups.
- **D23 — Booking de demos con Cal.com SaaS** (cal.com hosted; self-hosted previsto para H1). Reemplaza link estático Calendly. Booking link `cal.com/wasagro/30min` (event type `5923788`). Webhook `POST /webhook/calcom` (`BOOKING_CREATED`/`CANCELLED`/`REQUESTED`), firma HMAC-SHA256 sobre body raw, header `x-cal-signature-256`; cancelación NO revierte status automáticamente (P7), notifica al founder. Env `CALCOM_API_KEY`, `CALCOM_WEBHOOK_SECRET`, `CALCOM_BOOKING_URL`, `FOUNDER_PHONE/EMAIL`, `RESEND_API_KEY`. *Revisar:* >50 bookings/semana → batch en pg-boss. [ADR 014]
- **D24 — Chaser diferenciado.** Reenganche genérico (20h, HSM `sdr_reenganche_24h`) vs. recordatorio de booking (24h, cuando se envió el calendar link pero no agendó). Idempotente por `turns_total` y `calcom_booking_id`. `sdrChaserWorker.ts`. *Revisar:* >100 prospectos/día → dos colas pg-boss separadas.
- **D25 — Intent `meeting_waiting` (FSM sink state).** Una vez en `meeting_confirmed`, el agente nunca regresa a re-pitchear. Template `meetingWaiting` + safety net hardcodeado (nunca LLM). *Revisar:* re-scheduling → nuevo intent `meeting_reschedule`.

### Negocio: billing, costos, back-office

- **D26 — Billing: base + fincas + usuarios (pricing v2).** Enum `plan_org` (`trial`/`agricultor`/`productor`/`pyme`/`corporativo`/`free` + legado `starter`/`enterprise`). Trial 30 días → bloqueo. Precio = Base + $8 × fincas + $4 × usuarios. Base auto-determinada por rango de fincas: 1 finca (1-3 usuarios) = $10, 1 finca (4+ usuarios) = $15, 2-5 fincas = $15, 6-20 fincas = $25, 21+ = $50 negociable. Auto-clasificación: 1 finca + 4+ usuarios → productor. `pricingUtils.ts` exporta `calcularPrecio`, `getBasePrice`, `inferPlanSegment`, `getSegmentLabel`, `isPaidPlan`. Columnas nuevas: `fincas_contratadas`, `usuarios_contratados`, `precio_mensual` en `organizaciones`. **dLocal Go SmartFields** para internacional (auth `Bearer KEY:SECRET`, flow create→confirm, recurring sobre el checkout token) + **DeUna/transferencia** para Ecuador. Reemplaza a Stripe. `dlocalClient.ts`, `dlocalWebhookHandler.ts`, `BillingIntentHandler.ts`, `planGuard.ts`, `BillingView.tsx`, `pricingUtils.ts`. Env `DLOCALGO_API_KEY/SECRET/SMARTFIELDS_API_KEY/API_URL`. 4 segmentos internos (no visibles al cliente): Agricultor (1F, 1-3U), Productor (1-5F, variable), Pyme/Agroexportadora (6-20F), Corporativo (21+F, bancos/ONGs/asociaciones, precio custom). *Revisar:* >100 orgs → dunning automático; data real de uso → ajustar base por rango. [ADR 010]
- **D27 — Instrumentación de costos por org.** Tres fuentes: `wa_message_costs` (necesita `org_id`), `llm_call_costs` (tokens REALES de cada adapter, no `0`), y agregación mensual `costo_servicio_mensual` (job pg-boss). `costAggregatorWorker.ts`. *Revisar:* >10K inserts/día → buffer + batch; evaluar LangFuse como fuente de costo. [ADR 011]
- **D28 — Back-office interno `/admin`** (solo rol `director`). Pantallas: Clientes (plan, estado, P&L), Cliente detalle, SDR funnel, Alertas de gestión (job diario), Billing. `roleGuard.ts`, `adminRouter.ts`, `managementAlertsWorker.ts`. Depende de D26 + D27 para mostrar P&L. *Revisar:* >50 orgs → paginación server-side. [ADR 012]

### Agronómico especializado

- **D29 — Sub-pipeline de muestreo Sigatoka** sobre `documento_tabla` *(provisional — en validación con fichas reales).* Flujo: **detección en dos vías paralelas** (`sp-03g` detector binario sí/no fiable — gana — ‖ `sp-03c` clasificador general; keyword sobre OCR como red terciaria) → **pase de calidad** (`sp-03f`, tier fast: cortada/borrosa → pide otra foto, bajo falso-positivo) → **extractor en 4 pasadas paralelas** (`sp-03e1` izquierda/matriz+DATOS ‖ `sp-03e2a` tabla 11 sem ‖ `sp-03e2b` tabla 00 sem ‖ `sp-03e3` EF+plagas+diferidos; e2 partida en dos para capturar estado por celda + totales T=/Pr= por separado), merge + coerción string→number → `SigatokaMuestreoSchema` (Zod). **Checksum T= vs suma de filas** (`verificarChecksumTabla`): si no cuadra, re-extrae esa tabla UNA vez con hint correctivo; resultado persiste en `verificacion11sem`/`verificacion00sem`. **Crop+fallback para tablas de semanas**: e2a/e2b también corren sobre un recorte+zoom 3× de la región (en paralelo, sin latencia extra); `elegirMejorTabla` elige el mejor resultado entre crop y full-frame (checksum → columnas cuadran → filas con dato); si crop falla, queda el full-frame sin condición. [ADR 016, ADR 017] DATOS se modela en **3 columnas** (`resumenColumnas`, una por planta H1/H2/H3); recálculo determinista null-safe; **alertas sobre la peor columna** (J>10%, I>5%, H>30%, M<9). Umbrales en `UmbralesSeveridad` (`UMBRALES_SEVERIDAD_DEFAULT`), **configurables**: override por parámetro `umbrales` en `buildWhatsappSummary` (per-finca, futuro D18) y env `SIGATOKA_UMBRAL_EE2_LEVE`. El de **EE2 leve (H>30) es PLACEHOLDER** sin respaldo agronómico — confirmar con el agrónomo de la exportadora antes de la primera finca pagante (dispara alertas al cliente, P7). Si Zod falla, **fallback graceful** (`construirFallbackSigatoka` → `requires_review`, nunca tira). **Sector→lote**: rótulos de la matriz y de filas semana se mapean a `lote_id` por nombre. La **imagen original se persiste** (`eventos_campo.imagen_path`, bucket privado `eventos-media`). **Estado por celda** (`{valor, estado}`, I5): distingue vacía de ilegible en puntos Y en filas semana (identificador `"11sem-{fila}"`) → 1-5 ilegibles disparan el follow-up **"preguntar al tomador"** por WhatsApp (estado `pending_sigatoka_aclaracion`, `interpretarAclaracionSigatoka`, cap P2), >5 van a revisión humana. **Cap de re-captura** del gate (`decidirRecaptura`, máx 2, luego procesa igual). Revisión humana de los `requires_review` → **D30**. `SigatokaHandler.ts`, `CalidadSigatoka.ts`, `supabaseStorage.ts`. *Revisar:* primer test WhatsApp con ficha real (destraba el "provisional"); falsos positivos del gate; 2º formato → generalizar. [ADR 013]
- **D30 — UI de revisión de muestreos `requires_review`** (scoped a finca, NO el back-office de D28). Cola del asesor en `/dashboard/sigatoka`: lista los muestreos `requires_review` de su finca, muestra la imagen original (URL firmada del bucket privado) y permite completar las celdas ilegibles (reusa `aplicarAclaraciones`) o `marcar_revisado` (aprobación humana, P7). Endpoints en `fincaRouter` (`/api/finca/:id/sigatoka/revision`, `requireFincaAccessAsync`), `getSignedUrlEvento`, `SigatokaRevisionView.tsx`. El modo de corrección de celdas (pisa leídas) y la captura del feedback extraído-vs-corregido viven en **D32**. *Revisar:* revisión multi-finca para asesor de exportadora → extender o mover bajo back-office; volumen alto → paginación server-side. [ADR 015]
- **D32 — Flywheel de correcciones humanas Sigatoka** (feedback → evals, CR5). Captura el extraído-vs-corregido de cada muestreo para alimentar el dataset de evaluación y reducir la dependencia de revisión humana. Tabla `sigatoka_correcciones` (fuentes `asesor_ui` / `tomador_whatsapp`; RLS service_role) registra `valor/estado_extraido` (modelo) vs `valor_corregido` (humano); el insert es best-effort, nunca tumba el flujo (P4). `aplicarCorrecciones` (P7: el asesor pisa celdas ya leídas, a diferencia de `aplicarAclaraciones` que solo toca ilegibles) devuelve `{sigatoka, aplicadas, ignoradas}`; recalcula checksum y regenera `camposDudosos` (un muestreo corregido sale de `requires_review`). El PATCH de D30 acepta `correcciones[]`. Resumen WhatsApp por sub-bloques (11/00 sem con veredicto + columna que falla); **LECTURA INCOMPLETA** si DATOS < 3 columnas (no afirmar control sin las 3 plantas, P1). `SigatokaHandler.ts`, `supabaseQueries.ts`, `SigatokaRevisionView.tsx`, migr. `...061_add-sigatoka-correcciones`. *Revisar:* harness de evals que consuma el dataset (CR5); volumen alto → batch. [ADR 019]

### Provisioning de clientes

- **D33 — Provisioning atómico de clientes (alta founder-driven).** Endpoint interno `POST /internal/provision-client` protegido por `REPORTE_SECRET` (fail-closed, D31). La lógica vive en `src/agents/provisioning/provisionarCliente.ts` (función de dominio agnóstica del consumidor — no menciona Hono). Idempotencia por `phone`. Núcleo atómico: RPC `provisionar_cliente_atomico` (migr. 062) crea org + admin + consent en una transacción Postgres (P4/P6 — cero estado parcial). Trial diferido: `trial_inicio=NULL` al provisionar; el trial arranca cuando `onboarding_completo=true` (UPDATE idempotente). `planGuard` trata `trial_fin=null` como "trial activo" (org provisionada sin onboardear). Seed por cultivo: `seedMetricasPlantilla` + `seedFincaConfig` (best-effort, no bloquea el alta). `fincas.config JSONB` (migr. 063) almacena `sigatoka_umbrales` per-finca. Helpers: `getNextOrgId` (concurrencia-unsafe H0-R, documentado para H1), `createOrganizacion`, `createUsuarioAdmin`, `provisionarClienteAtomico` en `supabaseQueries.ts`. *Revisar:* D28 back-office absorbe `provisionarCliente()` sin reescritura; `getNextOrgId` → secuencia Postgres en H1 (>1 provisioning concurrente). [change client-provisioning, migr. 062/063]

### Seguridad

- **D31 — Endurecimiento de seguridad H0-R.** Auditoría en 4 capas previa a la primera finca pagante. Webhooks de pago (dLocal/DeUna) verificados con secreto/HMAC fail-closed (`webhookSecurity.ts`, env `DLOCALGO_WEBHOOK_SECRET`/`DEUNA_WEBHOOK_SECRET`). Aislamiento cross-tenant: `org_id` en JWT + `requireFincaAccessAsync` (`admin_org` acotado a su org; `director` global). Rate limiter fail-closed en auth. Ruta `api/auth/*.ts` con allow-list de orígenes + anti-enumeración. BD: `v_eventos_analisis` con `security_invoker`, guard en `buscar_eventos_similares`, fix de fuga en `get_fincas_con_coordenadas`, `search_path` pineado (migr. 058). Infra: LangFuse en loopback, Supabase SSL forzado, gate de autor en `claude.yml`, security headers en Vercel. *Revisar:* hacer `SUPABASE_ANON_KEY` obligatorio (RLS real); JWT a cookie httpOnly; completar `allowed_cidrs` de Supabase. Reporte/plan/perf/mantenimiento en `docs/runbooks/security-audit-2026-06.md`. [ADR 018]

---

## Estructura del repo

Repo único: `Agrow7-code/Wasagro`

```
Wasagro/
├── CLAUDE.md            ← Steering para Claude Code (este archivo)
├── AGENTS.md            ← Guardrails GGA pre-commit
├── src/
│   ├── webhook/         ← Handlers WhatsApp / Cal.com (recibir, validar, despachar)
│   ├── pipeline/        ← STT → LLM → extracción → Supabase + alertas
│   ├── agents/          ← Lógica conversacional: SDR, finca, métricas, admin, MCP tools
│   ├── auth/            ← OTP, planGuard, roleGuard
│   ├── workers/         ← Jobs pg-boss (intención, chaser, costos, alertas)
│   ├── integrations/    ← LLM (Gemini/Groq/NVIDIA), Supabase, Evolution, Deepgram,
│   │                       LangFuse, dLocal, DeUna, Cal.com, weather, market
│   └── types/           ← Zod schemas + TypeScript types
├── supabase/migrations/ ← SQL numeradas (timestamp-prefijado)
├── prompts/             ← System prompts del agente (sp-*)
├── docs/
│   ├── 01-problema-y-contexto.md
│   ├── 02-arquitectura.md
│   └── decisions/       ← ADRs (001-013). El índice de decisiones vivas está en CAPA 3.
└── tests/
```

## Convenciones de código

### SQL
- Tablas en español snake_case: `eventos_campo`, `user_consents`.
- UUIDs como PK (excepto `finca_id`/`lote_id`: TEXT `F001`, `F001-L01`).
- JSONB para `datos_evento`; PostGIS para `coordenadas` (POINT) y `poligono` (POLYGON).
- Migraciones numeradas por timestamp.

### Prompts del agente
- Voz y Tono: Notion → Sección 04.
- Vocabulario prohibido: "base de datos", "JSON", "tipo de evento", "sistema", "plataforma", "registrado exitosamente", "reformular".
- Tuteo Ecuador/Guatemala. Máx 3 líneas. Emojis solo ✅ ⚠️.

### Servicio backend (Hono/TypeScript)
- Un handler por caso de uso en `src/pipeline/`.
- Nombres de funciones en español descriptivo: `procesarReporteVoz`, `onboardarFinca`.
- Toda lógica de negocio tiene test unitario en `tests/`.
- Nunca lógica en el handler del webhook — solo recibir, validar con Zod, despachar.

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

1. Leer este archivo (automático).
2. `mem_search` en Engram para decisiones recientes.
3. Si necesitás contexto de Notion, leer vía MCP (no copiar).
4. Preguntar: "¿Qué vamos a construir hoy?" — no asumir.

## Gobernanza — Sincronización

### Qué va a cada sistema

| Tipo de cambio | GitHub | Notion | Engram |
|---|---|---|---|
| Código nuevo / modificado | commit | — | si decisión no-obvia |
| Schema SQL | migration numerada | — | — |
| Decisión de arquitectura | ADR + entrada en CAPA 3 | referencia al ADR | mem_save |
| Cambio en system prompt | `prompts/` | — | — |
| Hipótesis de producto nueva | — | crear página | — |
| Resultado de validación H0 | — | actualizar hipótesis | mem_save si aprendizaje técnico |
| Bug fix no-obvio | fix + commit | — | mem_save con root cause |

### Al completar cada tarea
1. `git add [archivos] && git commit && git push origin main`.
2. Si afecta arquitectura: crear/actualizar ADR en `docs/decisions/` **y** la entrada de CAPA 3.
3. Si afecta documentación de producto para stakeholders: actualizar Notion vía MCP.
4. Al final de cada página Notion actualizada: `🤖 Actualizado por Claude Code — [fecha]`.
5. Decisión técnica importante: `mem_save` en Engram.

### ADR — Architecture Decision Records
Cada decisión que reemplaza algo anterior requiere un ADR. CAPA 3 es el índice vivo; el ADR es el detalle. Formato:

```markdown
# NNN — Título de la decisión

**Fecha:** YYYY-MM-DD
**Estado:** Aceptada | Reemplazada por NNN+1

## Contexto
Por qué surgió.

## Decisión
Qué se decidió.

## Consecuencias
Qué cambia, qué se gana, qué se pierde.
```
