# Wasagro — CLAUDE.md

> Cerebro del proyecto para Claude Code. Tres capas: principios invariantes, criterios que toda herramienta debe cumplir, y decisiones vigentes. El **porqué histórico** de cada decisión vive en su ADR (`docs/decisions/`), no acá — este archivo es steering, no changelog.

## Identidad del proyecto

Wasagro es un sistema operativo de campo agrícola AI-first. Captura datos en fincas de exportación (cacao/banano) en Ecuador/Guatemala via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

- **Horizonte actual: H0-R** — producto funcional para la primera finca pagante.
- **Métrica Norte:** eventos de campo correctamente estructurados por semana por finca activa (accuracy ≥ 85%).
- **Modelo de negocio:** B2B enterprise — exportadora paga, agricultor usa gratis.
- **Por qué H0-R:** las primeras pruebas con usuarios reales mostraron que H0 (escrito sin probar) no creaba valor. El problema ya está confirmado; el objetivo ahora es entregar producto que funcione en campo, no "validar el problema".

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
- **D11 — Enrutador visual: tier `ocr` dedicado.** Clasificador en `fast`; OCR en tier `ocr` (NVIDIA: Nemotron-OCR-v1 primario, Kimi-K2.6, fallback DeepSeek-OCR/InternVL). Salida validada por `ResultadoOCRSchema` (Zod) con auto-corrección retry×2; fallback a `ultra` si no hay `NVIDIA_API_KEY`. *Revisar:* field-level accuracy OCR < 85%. [ADR 007]
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

- **D26 — Billing: suscripción mensual + trial 30 días.** Enum `plan_org` (`trial`/`free`/`starter`/`enterprise`) reemplaza `plan TEXT`. Trial 30 días → bloqueo (no degradación). **dLocal Go SmartFields** para internacional (auth `Bearer KEY:SECRET`, flow create→confirm, recurring sobre el checkout token) + **DeUna/transferencia** para Ecuador (comprobante por WhatsApp → `requiere_validacion`, aprobación manual del founder, P7). Reemplaza a Stripe (descartado: exige LLC en EE.UU.). `dlocalClient.ts`, `dlocalWebhookHandler.ts`, `BillingIntentHandler.ts`, `planGuard.ts`, `BillingView.tsx`. Env `DLOCALGO_API_KEY/SECRET/SMARTFIELDS_API_KEY/API_URL`. *Revisar:* data real de uso → modelo híbrido (flat + overage); >100 orgs → dunning automático. [ADR 010]
- **D27 — Instrumentación de costos por org.** Tres fuentes: `wa_message_costs` (necesita `org_id`), `llm_call_costs` (tokens REALES de cada adapter, no `0`), y agregación mensual `costo_servicio_mensual` (job pg-boss). `costAggregatorWorker.ts`. *Revisar:* >10K inserts/día → buffer + batch; evaluar LangFuse como fuente de costo. [ADR 011]
- **D28 — Back-office interno `/admin`** (solo rol `director`). Pantallas: Clientes (plan, estado, P&L), Cliente detalle, SDR funnel, Alertas de gestión (job diario), Billing. `roleGuard.ts`, `adminRouter.ts`, `managementAlertsWorker.ts`. Depende de D26 + D27 para mostrar P&L. *Revisar:* >50 orgs → paginación server-side. [ADR 012]

### Agronómico especializado

- **D29 — Sub-pipeline de muestreo Sigatoka** sobre `documento_tabla` *(provisional — en validación con fichas reales).* Flujo: clasificación (`sp-03c`, enum `muestreo_sigatoka_banano`, o safety net por keywords) → **pase de calidad** (`sp-03f`, tier fast: cortada/borrosa → pide otra foto, bajo falso-positivo) → **extractor** (`sp-03e`, tier `ultra`) → `SigatokaMuestreoSchema` (Zod). DATOS se modela en **3 columnas** (`resumenColumnas`, una por planta H1/H2/H3); recálculo determinista null-safe; **alertas sobre la peor columna** (J>10%, I>5%, M<9). Si Zod falla, **fallback graceful** (`construirFallbackSigatoka` → `requires_review`, nunca tira). **Sector→lote**: rótulos de la matriz se mapean a `lote_id` por nombre. La **imagen original se persiste** (`eventos_campo.imagen_path`, bucket privado `eventos-media`). Diferidos opcionales sin lógica: 00-semanas, P-EF-FINCA, erradicadas-BSV. `SigatokaHandler.ts`, `CalidadSigatoka.ts`, `supabaseStorage.ts`. *Pendiente:* flujo "preguntar al tomador" ≤5 dudosos, cap de re-captura (P2), UI de revisión (D28) + signed URLs. *Revisar:* primer test WhatsApp; falsos positivos del gate; 2º formato → generalizar. [ADR 013]

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
