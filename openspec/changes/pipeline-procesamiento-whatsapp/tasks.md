# Tasks: pipeline-procesamiento-whatsapp
> Change: pipeline-procesamiento-whatsapp | Phase: sdd-tasks | Date: 2026-04-10

---

## Summary
- **Total tasks**: 22
- **Phases**: 5
- **Estimated sessions**: 8–10 (rough, for planning)
- **Blocking dependencies**:
  - T-SQL-01 blocks T-SQL-02, T-SQL-03, T-SQL-04, T-SQL-05, T-SQL-06, and all FLOW tasks
  - T-SQL-02 (user_consents) blocks T-FLOW-02 (onboarding — legal blocker P6)
  - T-SQL-03 (sesiones_activas) blocks T-FLOW-01 (routing) and T-FLOW-02 (clarification state)
  - T-SQL-04 (mensajes_entrada) blocks T-FLOW-01 (idempotency) and T-SQL-06 (FK constraint)
  - T-LANGFUSE-01 blocks T-FLOW-01 through T-FLOW-04 (all flows must log to LangFuse — D9)
  - T-PROMPT-01 through T-PROMPT-05 must exist before T-FLOW-02 and T-FLOW-04
  - T-FLOW-02 (flujo-03 onboarding) must be functional before T-FLOW-03 (flujo-02 pipeline)
  - All Phase 1–4 tasks must be complete before Phase 5 (integration testing)

---

## Phase 1 — SQL Schema

### T-SQL-01: Schema core — usuarios, fincas, lotes, eventos_campo
**Spec refs**: REQ-persistence-003, REQ-persistence-004, REQ-persistence-007
**Design refs**: `01-schema-core.sql`, ADR (RLS by finca_id, service_role bypass for n8n)
**File(s)**: `backend/sql/01-schema-core.sql`
**Done when**:
- [ ] File `backend/sql/01-schema-core.sql` created with full DDL from design.md
- [ ] Extensions `uuid-ossp` and `postgis` are created with `IF NOT EXISTS`
- [ ] ENUMs created: `tipo_evento` (labor, insumo, plaga, clima, cosecha, gasto, observacion, nota_libre), `status_evento` (draft, complete, requires_review), `rol_usuario`
- [ ] Table `fincas` created: `finca_id TEXT PK`, `nombre`, `ubicacion`, `pais`, `cultivo_principal`, `coordenadas geography(POINT,4326)`, `poligono geography(POLYGON,4326)`, `hectareas_total`, `activa BOOLEAN DEFAULT true`, `created_at`, `updated_at`
- [ ] Table `usuarios` created: `id UUID PK DEFAULT gen_random_uuid()`, `phone TEXT UNIQUE`, `nombre`, `rol rol_usuario DEFAULT 'agricultor'`, `finca_id TEXT REFERENCES fincas`, `onboarding_completo BOOLEAN DEFAULT false`, `consentimiento_datos BOOLEAN DEFAULT false`, `idioma TEXT DEFAULT 'es'`, `created_at`, `updated_at`
- [ ] Table `lotes` created: `lote_id TEXT PK`, `finca_id TEXT NOT NULL REFERENCES fincas`, `nombre_coloquial TEXT NOT NULL`, `cultivo`, `hectareas`, `coordenadas geography(POINT,4326)`, `poligono geography(POLYGON,4326)`, `activo BOOLEAN DEFAULT true`, `created_at`, `updated_at`
- [ ] Table `eventos_campo` created: `id UUID PK`, `finca_id TEXT NOT NULL REFERENCES fincas`, `lote_id TEXT REFERENCES lotes (nullable)`, `tipo_evento tipo_evento NOT NULL`, `status status_evento NOT NULL DEFAULT 'draft'`, `datos_evento JSONB NOT NULL DEFAULT '{}'`, `descripcion_raw TEXT NOT NULL`, `confidence_score NUMERIC(3,2)`, `requiere_validacion BOOLEAN DEFAULT false`, `fecha_evento DATE DEFAULT CURRENT_DATE`, `created_by UUID REFERENCES usuarios`, `mensaje_id UUID` (FK added later in 04), `severidad TEXT`, `created_at`, `updated_at`
- [ ] All basic indexes created: `idx_usuarios_phone`, `idx_usuarios_finca`, `idx_lotes_finca`, `idx_eventos_finca`, `idx_eventos_lote`, `idx_eventos_tipo`, `idx_eventos_status`, `idx_eventos_fecha`, `idx_eventos_created_at`, `idx_eventos_finca_fecha`
- [ ] RLS enabled on all 4 tables with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- [ ] RLS policies created: `usuarios_own_finca`, `fincas_by_user`, `lotes_by_finca`, `eventos_by_finca` — all scoped via `auth.uid()` → `usuarios.finca_id`
- [ ] Migration executed against Supabase (SQL Editor or CLI) without errors
- [ ] RLS verified: with user JWT for finca F001, `SELECT * FROM fincas` returns only F001 row
**Notes**: n8n uses `service_role` key which bypasses RLS — no additional service_role policies needed. `eventos_campo.mensaje_id` is created without FK here; the FK is added in `04-patch-mensajes-entrada.sql`. Do NOT add `nota_libre` to `tipo_evento` ENUM as a fallback type — it is already a valid `tipo_evento` value in the enum.

---

### T-SQL-02: Parche user_consents — bloqueante legal
**Spec refs**: REQ-onboarding-003, REQ-persistence-004, P6 (CLAUDE.md)
**Design refs**: `02-patch-user-consents.sql`
**File(s)**: `backend/sql/02-patch-user-consents.sql`
**Done when**:
- [ ] File `backend/sql/02-patch-user-consents.sql` created
- [ ] Table `user_consents` created: `id UUID PK`, `user_id UUID NOT NULL REFERENCES usuarios ON DELETE CASCADE`, `phone TEXT NOT NULL`, `tipo TEXT NOT NULL CHECK (tipo IN ('datos','comunicaciones','ubicacion'))`, `texto_mostrado TEXT NOT NULL`, `aceptado BOOLEAN NOT NULL`, `ip_address TEXT`, `created_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] Comment in file: "No UPDATE ni DELETE — cada cambio de consentimiento es un nuevo INSERT (auditoría inmutable)"
- [ ] Indexes created: `idx_consents_user`, `idx_consents_phone`, `idx_consents_tipo_user`
- [ ] RLS enabled + policy `consents_own_user` (`user_id = auth.uid()`)
- [ ] Migration executed against Supabase without errors
- [ ] Verified: INSERT a consent record, then SELECT with matching user JWT — record visible. SELECT with different user JWT — record NOT visible.
**Notes**: This table is a LEGAL BLOCKER (P6). No onboarding can complete without it. No UPDATE or DELETE should ever be executed on this table — each consent change is a new row.

---

### T-SQL-03: Parche sesiones_activas — bloqueante operativo
**Spec refs**: REQ-conversation-001, REQ-conversation-004, REQ-conversation-007
**Design refs**: `03-patch-sesiones-activas.sql`
**File(s)**: `backend/sql/03-patch-sesiones-activas.sql`
**Done when**:
- [ ] File `backend/sql/03-patch-sesiones-activas.sql` created
- [ ] Table `sesiones_activas` created: `session_id UUID PK`, `phone TEXT NOT NULL`, `finca_id TEXT REFERENCES fincas`, `tipo_sesion TEXT NOT NULL CHECK (tipo_sesion IN ('reporte','onboarding'))`, `clarification_count INTEGER DEFAULT 0 CHECK (clarification_count >= 0 AND clarification_count <= 3)`, `paso_onboarding INTEGER`, `contexto_parcial JSONB DEFAULT '{}'`, `ultimo_mensaje_at TIMESTAMPTZ DEFAULT NOW()`, `expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')`, `status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','fallback_nota_libre','expired'))`, `created_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] Indexes: `idx_sesiones_phone_status` (partial WHERE status='active'), `idx_sesiones_expires` (partial WHERE status='active')
- [ ] RLS enabled (no auth.uid() policy — service_role only)
- [ ] Migration executed against Supabase without errors
- [ ] Verified: INSERT a session, SELECT with `status='active' AND expires_at > NOW()` returns it; SELECT 31 minutes later returns empty (simulate by setting `expires_at = NOW() - INTERVAL '1 minute'`)
**Notes**: This table implements R2 (max 2 clarifications). The `clarification_count` check constraint allows up to 3 (buffer) but the application logic MUST enforce the 2-question limit. No RLS policy for auth.uid() is needed here — only n8n service_role accesses this table.

---

### T-SQL-04: Parche mensajes_entrada — idempotencia
**Spec refs**: REQ-webhook-004, REQ-persistence-002, REQ-persistence-005
**Design refs**: `04-patch-mensajes-entrada.sql`
**File(s)**: `backend/sql/04-patch-mensajes-entrada.sql`
**Done when**:
- [ ] File `backend/sql/04-patch-mensajes-entrada.sql` created
- [ ] Table `mensajes_entrada` created: `id UUID PK`, `wa_message_id TEXT NOT NULL UNIQUE`, `phone TEXT NOT NULL`, `finca_id TEXT REFERENCES fincas`, `tipo_mensaje TEXT NOT NULL CHECK (tipo_mensaje IN ('text','audio','image'))`, `contenido_raw TEXT`, `media_ref TEXT`, `evento_id UUID REFERENCES eventos_campo`, `status TEXT DEFAULT 'received' CHECK (status IN ('received','processing','processed','error','duplicate'))`, `langfuse_trace_id TEXT`, `error_detail TEXT`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] `wa_message_id UNIQUE` constraint confirmed — this is the idempotency key
- [ ] Indexes: `idx_mensajes_wamid`, `idx_mensajes_phone`, `idx_mensajes_status`, `idx_mensajes_finca`, `idx_mensajes_created`
- [ ] RLS enabled + policy `mensajes_by_finca`
- [ ] FK added to `eventos_campo.mensaje_id`: `ALTER TABLE eventos_campo ADD CONSTRAINT fk_eventos_mensaje FOREIGN KEY (mensaje_id) REFERENCES mensajes_entrada(id)`
- [ ] Migration executed against Supabase without errors
- [ ] Idempotency test: INSERT `wa_message_id='test_wamid'` twice — second INSERT fails with UNIQUE violation
**Notes**: DA-08 amendment — first 30 audio messages must be stored to `audio-eval/` Supabase Storage bucket. The `media_ref` column holds the path `audio-eval/{wamid}.opus` for eval-stored audios. The counter logic lives in the n8n flow (T-FLOW-03), not in SQL.

---

### T-SQL-05: Parche wa_message_costs — tracking de costos
**Spec refs**: REQ-persistence-006
**Design refs**: `05-patch-wa-message-costs.sql`
**File(s)**: `backend/sql/05-patch-wa-message-costs.sql`
**Done when**:
- [ ] File `backend/sql/05-patch-wa-message-costs.sql` created
- [ ] Table `wa_message_costs` created: `id UUID PK`, `finca_id TEXT REFERENCES fincas`, `phone TEXT`, `direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound'))`, `message_type TEXT NOT NULL CHECK (message_type IN ('text','audio','image','template','reaction'))`, `conversation_type TEXT CHECK (conversation_type IN ('user_initiated','business_initiated'))`, `cost_usd NUMERIC(10,6) DEFAULT 0`, `wa_message_id TEXT`, `metadata JSONB DEFAULT '{}'`, `created_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] Indexes: `idx_costs_finca`, `idx_costs_created`, `idx_costs_finca_month`
- [ ] RLS enabled + policy `costs_by_finca`
- [ ] Migration executed against Supabase without errors
**Notes**: User-initiated messages within the 24h conversation window cost $0 for replies (D6). Template messages outside the 24h window carry the applicable Meta rate for Ecuador/Guatemala.

---

### T-SQL-06: Parche índices y vistas NSM — Métrica Norte
**Spec refs**: REQ-persistence-003 (performance), H0 North Star Metric
**Design refs**: `06-patch-indices.sql`, views `v_nsm`, `v_nsm_global`, `v_pipeline_health`
**File(s)**: `backend/sql/06-patch-indices.sql`
**Done when**:
- [ ] File `backend/sql/06-patch-indices.sql` created
- [ ] `idx_nsm_eventos` created: partial index on `eventos_campo(finca_id, created_at) WHERE status='complete'`
- [ ] View `v_nsm` created: eventos completos por finca por semana (COUNT, tipos_distintos, lotes_activos, confidence_promedio)
- [ ] View `v_nsm_global` created: totales globales, pct_notas_libres, confidence_promedio_global
- [ ] View `v_pipeline_health` created: mensajes_24h, procesados, errores, pendientes, tasa_exito_pct (last 24h)
- [ ] Additional indexes: `idx_lotes_finca_activos` (partial WHERE activo=true), `idx_eventos_finca_semana` (partial WHERE last 7 days), `idx_sesiones_expired` (partial WHERE status='active')
- [ ] Migration executed against Supabase without errors
- [ ] Verified: `SELECT * FROM v_nsm` returns empty (no data yet) without errors; `SELECT * FROM v_pipeline_health` returns zeros
**Notes**: `idx_eventos_finca_semana` uses a partial expression filter — verify Postgres accepts the syntax `WHERE created_at > NOW() - INTERVAL '7 days'` (this is evaluated at index creation time, not dynamically; may need to use a different approach or just document that this index is a range index with no partial filter). If Postgres rejects the filter, remove it and rely on the composite index.

---

## Phase 2 — System Prompts

### T-PROMPT-01: SP-01 — Extracción de eventos de campo
**Spec refs**: REQ-extraction-001, REQ-extraction-002, REQ-extraction-003 (R1 — null-first rule)
**Design refs**: SP-01 full text in design.md §System Prompts Architecture
**File(s)**: `prompts/sp-01-extraccion.md`
**Done when**:
- [ ] File `prompts/sp-01-extraccion.md` created with full system prompt text from design.md
- [ ] The instruction "Si no puedes determinar un campo con certeza, devuelve null para ese campo con confidence menor a 0.5. NUNCA asumas, completes, ni generes valores que el agricultor no haya mencionado explícitamente." is present VERBATIM (R1 constraint)
- [ ] Injection variables documented in file header: `{{LISTA_LOTES}}`, `{{FINCA_NOMBRE}}`, `{{CULTIVO_PRINCIPAL}}`, `{{PAIS}}`
- [ ] All 7 `tipo_evento` values and their JSON field schemas are included: `labor`, `insumo`, `plaga`, `clima`, `cosecha`, `gasto`, `observacion`
- [ ] Full agricultural glossary from CLAUDE.md included (bombada, caneca, quintal/qq, jornal, colino, escoba, helada, riel, mazorca negra, rechazo, brix)
- [ ] "helada" → moniliasis clarification rule explicitly stated
- [ ] Output JSON schema included with `confidence_por_campo`, `campos_faltantes`, `requiere_clarificacion`, `pregunta_sugerida`
- [ ] Confidence score scale (0.9-1.0 explicit, 0.7-0.89 high-inference, etc.) documented
- [ ] Token estimate noted in file header (approximate input tokens with full context injection)
**Notes**: R1 constraint — the null-first instruction must use the verbatim phrasing from design.md. Do NOT summarize or paraphrase it. This is the most critical prompt in the system — incorrect extraction causes real agricultural harm (P1).

---

### T-PROMPT-02: SP-02 — Post-corrección STT
**Spec refs**: REQ-extraction-005
**Design refs**: SP-02 full text in design.md §System Prompts Architecture
**File(s)**: `prompts/sp-02-post-correccion-stt.md`
**Done when**:
- [ ] File `prompts/sp-02-post-correccion-stt.md` created with full prompt text
- [ ] All 5 correction rules included: correct only obvious errors, don't change meaning, don't add information, keep colloquial style, leave original if unsure
- [ ] Full corrections table included (la rolla → la roya, monilia → moniliasis, sigato ka → Sigatoka, escova → escoba, mancose → Mancozeb, etc.)
- [ ] Cacao and banano cultivar/disease context sections included
- [ ] Output rule stated: "Devuelve SOLO el texto corregido, sin explicaciones ni notas adicionales"
- [ ] No injection variables in this prompt (static — same for all users)
- [ ] Token estimate noted in file header
**Notes**: Post-correction must NOT add content not in the original audio. If raw and corrected texts are identical, output the original unchanged. This is tested in SC-extraction-001 and SC-extraction-003.

---

### T-PROMPT-03: SP-03 — Análisis de imagen (Vision)
**Spec refs**: REQ-extraction-006
**Design refs**: SP-03 full text in design.md §System Prompts Architecture
**File(s)**: `prompts/sp-03-vision.md`
**Done when**:
- [ ] File `prompts/sp-03-vision.md` created with full prompt text
- [ ] Rule "Describe SOLO lo que ves. NUNCA inventes detalles que no estén visibles." present verbatim
- [ ] Full list of detectable plagues/diseases per crop included (Sigatoka, moniliasis, escoba de bruja, mazorca negra, nematodos, cochinilla, roya)
- [ ] Severity scale included: leve (<10%), moderada (10-30%), severa (30-60%), crítica (>60%)
- [ ] Injection variables documented: `{{FINCA_NOMBRE}}`, `{{CULTIVO_PRINCIPAL}}`, `{{PAIS}}`, `{{CAPTION}}`
- [ ] Output JSON schema included with `descripcion_general`, `elementos_detectados[]`, `calidad_imagen`, `tipo_evento_sugerido`, `requiere_visita_campo`
- [ ] "No-content" response schema included (for non-agricultural images)
- [ ] Token estimate noted in file header (vision tokens are higher due to image encoding)
**Notes**: R1 constraint applies — model must NOT infer lot_id, quantities, or product names from the image unless explicitly visible. Vision analysis output feeds directly into SP-01 extraction.

---

### T-PROMPT-04: SP-04 — Onboarding conversacional
**Spec refs**: REQ-onboarding-002, REQ-onboarding-003, REQ-onboarding-004
**Design refs**: SP-04 full text in design.md §System Prompts Architecture
**File(s)**: `prompts/sp-04-onboarding.md`
**Done when**:
- [ ] File `prompts/sp-04-onboarding.md` created with full prompt text
- [ ] Personality rules included: tuteo Ecuador/Guatemala, máximo 3 líneas, emojis solo ✅ y ⚠️
- [ ] Prohibited vocabulary list included: "base de datos", "JSON", "tipo de evento", "sistema", "plataforma", "registrado exitosamente", "reformular"
- [ ] Injection variables documented: `{{PASO_ACTUAL}}`, `{{DATOS_RECOPILADOS}}`
- [ ] Exact consent text for step 2 included VERBATIM: "Para registrar tus reportes de campo necesito tu autorización. Tus datos son tuyos — solo se usan para generar tus reportes y los de tu finca. Nadie más los ve sin tu permiso. ¿Aceptas que almacene los datos de tu finca?"
- [ ] Rejection response text for step 2 included: "Entendido, sin problema. Si cambias de opinión, escríbeme de nuevo."
- [ ] All 5 step handlers documented with exact question text and extraction targets
- [ ] Output JSON schema included: `paso_completado`, `siguiente_paso`, `datos_extraidos`, `mensaje_para_usuario`, `onboarding_completo`
- [ ] Max 2 clarification attempts per step rule documented
- [ ] Token estimate noted in file header
**Notes**: The consent text in step 2 MUST be stored verbatim in `user_consents.texto_mostrado` — do not truncate or paraphrase. This is REQ-onboarding-003 compliance.

---

### T-PROMPT-05: SP-05 — Reporte semanal
**Spec refs**: REQ-observability-001 (spans for flujo-04)
**Design refs**: SP-05 full text in design.md §System Prompts Architecture
**File(s)**: `prompts/sp-05-reporte-semanal.md`
**Done when**:
- [ ] File `prompts/sp-05-reporte-semanal.md` created with full prompt text
- [ ] Personality rules: professional, tuteo, max 10 lines, no filler
- [ ] Prohibited vocabulary list included (same as SP-04)
- [ ] Injection variables documented: `{{FINCA_NOMBRE}}`, `{{CULTIVO_PRINCIPAL}}`, `{{FECHA_INICIO}}`, `{{FECHA_FIN}}`, `{{EVENTOS_AGREGADOS}}`
- [ ] 5-part summary structure documented: apertura, actividades principales, alertas, lotes más activos, pendientes
- [ ] Rules documented: plagues always first, emojis ✅/⚠️ only, no confidence_scores or internal system data
- [ ] "No activity" rule: if no events in the week, the flow does NOT call this prompt (flow-level decision)
- [ ] Token estimate noted in file header
**Notes**: This prompt is H0-only. No complex aggregation logic lives in the prompt — data aggregation happens in n8n nodes before calling this prompt. The prompt only formats pre-aggregated data.

---

## Phase 3 — LangFuse Setup

### T-LANGFUSE-01: Deploy LangFuse self-hosted on Supabase Postgres
**Spec refs**: REQ-observability-001, REQ-observability-002, REQ-observability-003
**Design refs**: D5 (LangFuse self-hosted, CR5), LangFuse integration design section in design.md
**File(s)**: N/A (infrastructure setup — no repo files)
**Done when**:
- [ ] LangFuse Docker container (or Railway/Render deployment) is running and accessible via HTTPS URL
- [ ] LangFuse is connected to the Supabase Postgres database (shared, as per D5 — no separate DB cost)
- [ ] LangFuse project "wasagro-h0" created with API keys generated
- [ ] Environment variables documented (NOT committed): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
- [ ] A test trace is created via the LangFuse SDK (or direct API) and visible in the LangFuse UI: trace named `test_trace_setup`, with one span `test_span` containing `input_raw`, `output`, `model`, `latency_ms`, `cost_usd` fields
- [ ] LangFuse UI loads and the test trace is queryable by name
- [ ] n8n has access to the LangFuse credentials as environment variables (configured in n8n settings, not hardcoded in flows)
- [ ] LangFuse dataset "audio-eval-h0" created manually for H-TEC-02 tagging (REQ-observability-006)
**Notes**: D9 constraint — LangFuse MUST be operational before any real users (W3). This is a hard dependency for Phase 4 flows. If LangFuse is down, flows should degrade gracefully (log locally) but NEVER fail silently (REQ-observability-004). The shared Postgres approach is fine for H0 — revisit when traces saturate the DB (D5 review trigger).

---

## Phase 4 — n8n Flows

### T-FLOW-01: flujo-01-recibir-mensaje
**Spec refs**: REQ-webhook-001 through REQ-webhook-006, SC-webhook-001 through SC-webhook-007
**Design refs**: flujo-01 node contracts table in design.md, SD-01 (happy path sequence), SD-05 (onboarding routing)
**File(s)**: `flows/flujo-01-recibir-mensaje.json` (n8n exported JSON)
**Done when**:
- [ ] n8n workflow created with name "flujo-01-recibir-mensaje"
- [ ] Node **"Webhook WhatsApp"**: HTTP POST trigger. Responds HTTP 200 IMMEDIATELY before any downstream node runs (REQ-webhook-001). Response body: `{"status":"ok"}`. Configured to return response before executing remaining nodes.
- [ ] Node **"Validar firma"**: HMAC-SHA256 verification of `x-hub-signature-256` header against `WHATSAPP_APP_SECRET`. On failure: log event to LangFuse (`invalid_webhook_signature`, source IP, timestamp) and STOP — no user notification (SC-webhook-004)
- [ ] Node **"Extraer mensaje"**: Parses Meta Cloud API payload. Extracts `wa_message_id` (wamid), `from` (phone E.164 without +), `timestamp`, `type` (text/audio/image), type-specific content. Unsupported types (sticker, document, video) are logged and discarded — no response to user (SC-webhook-007)
- [ ] Node **"Verificar idempotencia"**: SELECT on `mensajes_entrada` by `wa_message_id`. If exists: set `status='duplicate'`, STOP. If not: INSERT with `status='received'` (this INSERT is the idempotency lock — SC-webhook-003). Uses Supabase service_role key.
- [ ] Node **"Buscar usuario"**: SELECT `usuarios` by `phone`. Returns `user_exists`, `onboarding_completo`, `consentimiento_datos`, `finca_id`, `cultivo_principal`, lotes list.
- [ ] Node **"Switch: Estado del usuario"**: 4-branch switch per REQ-webhook-005: (A) user not found → call flujo-03-onboarding, (B) `onboarding_completo=false` → call flujo-03-onboarding (resume), (C) `consentimiento_datos=false` → send consent request message (no extraction), (D) all OK → continue to type switch
- [ ] Node **"Switch: Tipo de mensaje"**: text greeting heuristic (starts with "hola"/"gracias"/contains "?") → direct reply without pipeline. All `audio`/`image` → continue to ack. Text classified as report → continue to ack.
- [ ] Node **"Enviar acuse de recibo"**: POST to `graph.facebook.com/v21.0/{{PHONE_NUMBER_ID}}/messages` with body `{ messaging_product: "whatsapp", to: phone, type: "text", text: { body: "Estoy procesando tu reporte..." } }`. Must fire within 5s of webhook receipt (P3 / REQ-webhook-006). Configured BEFORE "Disparar flujo-02" node.
- [ ] Node **"Disparar flujo-02"**: Execute sub-workflow flujo-02 with context: `mensaje_entrada_id`, `wa_message_id`, `phone`, `finca_id`, `tipo_mensaje`, `contenido_raw`, `media_ref`, `user_context` (finca_nombre, cultivo, lotes array)
- [ ] All node names are in Spanish as per CLAUDE.md conventions
- [ ] Error handling paths: DB errors → user message "Hubo un problema, intenta de nuevo en unos minutos." Meta API errors for ack → log to LangFuse, continue pipeline (ack failure is non-blocking)
- [ ] Tested with sample text payload (SC-webhook-001): HTTP 200 returned, `mensajes_entrada` row created, ack sent, flujo-02 triggered
- [ ] Tested with duplicate wamid (SC-webhook-003): second call produces no new DB rows, no second ack
- [ ] Tested with invalid signature (SC-webhook-004): payload discarded, LangFuse log created, no user message
**Notes**: The HTTP 200 response MUST be configured as an immediate response in n8n — this is done by enabling "Respond to Webhook" mode set to "Immediately" (or equivalent n8n option). If n8n's default mode waits for all nodes to complete before responding, this WILL cause Meta to retry and create duplicate messages.

---

### T-FLOW-02: flujo-03-onboarding (must be done before flujo-02)
**Spec refs**: REQ-onboarding-001 through REQ-onboarding-007, SC-onboarding-001 through SC-onboarding-005
**Design refs**: flujo-03 node contracts table, SD-05 (onboarding sequence diagram)
**File(s)**: `flows/flujo-03-onboarding.json`
**Done when**:
- [ ] n8n workflow created with name "flujo-03-onboarding"
- [ ] Node **"Verificar estado onboarding"**: SELECT `usuarios` by `phone` and `sesiones_activas` WHERE `tipo_sesion='onboarding' AND status='active'`. Returns `paso_actual` (1-5), `datos_existentes`, `session_id`. If user exists with an intermediate step (no active session but `onboarding_completo=false`), reads step from `usuarios` table.
- [ ] Node **"Switch: Paso actual"**: routes to correct step handler based on `paso_actual`
- [ ] **Paso 1** handler: send welcome + ask name/role. On user response: INSERT `usuarios` (`phone`, `nombre`, `rol`, `onboarding_completo=false`). INSERT/UPDATE `sesiones_activas` (`tipo_sesion='onboarding'`, `paso_onboarding=2`). Advance to paso 2.
- [ ] **Paso 2** handler: send EXACT consent text from SP-04. On user response "sí"/"acepto" → INSERT `user_consents` (`user_id`, `phone`, `tipo='datos'`, `texto_mostrado`=verbatim text, `aceptado=true`, `created_at`=NOW()). If provisional first-message data exists in `contexto_parcial`: carry forward. On "no"/"no acepto" → INSERT `user_consents` (`aceptado=false`), discard `contexto_parcial`, send rejection message, STOP. UPDATE `sesiones_activas` `paso_onboarding=3` on accept.
- [ ] **Paso 3** handler: ask farm name, location, main crop. Parse with LLM (SP-04). INSERT `fincas` (`finca_id='F{NNN}'` auto-assigned, `nombre`, `ubicacion`, `cultivo_principal`). UPDATE `sesiones_activas` `paso_onboarding=4`.
- [ ] **Paso 4** handler: ask lot list. Parse with LLM (SP-04). INSERT each lot into `lotes` (`lote_id='{finca_id}-L{NN}'`, `nombre_coloquial` verbatim, `hectareas` if mentioned). Send confirmation list: "Entonces tenés: [lista]. ¿Está bien?". Wait for user confirmation. If "no": allow correction. UPDATE `sesiones_activas` `paso_onboarding=5` on confirmation.
- [ ] **Paso 5** handler: UPDATE `usuarios` SET `onboarding_completo=true`, `finca_id`. UPDATE `sesiones_activas` SET `status='completed'`. If provisional data in `contexto_parcial`: persist to `eventos_campo` now (finca_id is available). Send activation message: "Listo, ya podés enviar tus reportes de campo. Solo mandame un mensaje con lo que pasó en la finca ✅"
- [ ] LangFuse trace created: `onboarding_{phone_hash}` with span per step that uses LLM. Lot list parsing (paso 4) has full span with `input_raw`, `output`, `model`, `latency_ms`, `cost_usd` (REQ-onboarding-007). Trace closed on step 5 or consent rejection.
- [ ] SC-onboarding-003 (mid-onboarding resumption): when user returns after abandonment, flow detects current step from `usuarios` (durable), not from expired session. Sends context reminder.
- [ ] SC-onboarding-004/005 (provisional data): first-message data held in `sesiones_activas.contexto_parcial`, NOT in `eventos_campo`. Persisted after consent acceptance, discarded on rejection.
- [ ] Error paths: all DB errors produce user message "Hubo un problema, intenta de nuevo." Meta API errors: retry x1. LLM errors for parsing: attempt regex fallback, log.
- [ ] Tested end-to-end: new user → 5 steps → `onboarding_completo=true`, `user_consents` record, `fincas` record, `lotes` records exist
**Notes**: This flow is a HARD PREREQUISITE for flujo-02. No report can be processed until onboarding completes. The provisional data flow (SC-onboarding-004/005) is complex — validate carefully that `eventos_campo` is NOT written until after consent is accepted in paso 2.

---

### T-FLOW-03: flujo-02-procesar-reporte (core pipeline)
**Spec refs**: REQ-extraction-001 through REQ-extraction-007, REQ-conversation-001 through REQ-conversation-007, REQ-persistence-001 through REQ-persistence-007, REQ-observability-001 through REQ-observability-005, SC-conversation-005 (MUST)
**Design refs**: flujo-02 node contracts table, SD-01 through SD-04 sequence diagrams
**File(s)**: `flows/flujo-02-procesar-reporte.json`
**Done when**:
- [ ] n8n workflow created with name "flujo-02-procesar-reporte"
- [ ] Node **"Iniciar traza LangFuse"**: creates trace `whatsapp_message_{wa_message_id}` with metadata: `phone`, `finca_id`, `tipo_mensaje`, `wa_message_id`. Span `autenticar_usuario` logged. (REQ-observability-001)
- [ ] Node **"Buscar sesión activa"**: SELECT `sesiones_activas` WHERE `phone=? AND tipo_sesion='reporte' AND status='active' AND expires_at > NOW()`. **SC-conversation-005 (MUST)**: If active session exists AND the incoming message is a NEW report (not a clarification reply — detected by content/heuristic), the existing session MUST be closed as `fallback_nota_libre` and a `nota_libre` `eventos_campo` record created for the prior incomplete event BEFORE processing the new message as a fresh session. This behavior MUST be deterministic — no ambiguity.
- [ ] Node **"Switch: Tipo de contenido"** routes to 3 branches: audio, image, text
- [ ] **Audio branch** — Node **"Descargar media"**: GET `graph.facebook.com/v21.0/{media_id}` with Bearer token → GET download URL. Span `descargar_media` logged with `file_size_bytes`. If eval counter < 30: upload binary to Supabase Storage `audio-eval/{wamid}.opus`, increment counter (DA-08 / REQ-persistence-005). Tag trace with `dataset='audio-eval-h0'` if within first 30 (REQ-observability-006). Update `mensajes_entrada.media_ref`.
- [ ] **Audio branch** — Node **"STT Transcripción"**: GPT-4o Mini Transcribe call. Model name read from n8n environment variable `STT_MODEL` (not hardcoded — REQ-extraction-004). Span `stt_transcripcion` logged with ALL required fields: `audio_ref`, `duration_sec`, `output`, `model`, `latency_ms`, `cost_usd`. Store raw transcription in `mensajes_entrada.contenido_raw`. Error: log to LangFuse FIRST, then send user "No pude procesar el audio, ¿podés enviarlo de nuevo o escribirlo como texto?"
- [ ] **Audio branch** — Node **"Post-corrección STT"**: GPT-4o Mini with SP-02. Span `stt_post_correccion` logged with `input_raw` (raw transcription), `output` (corrected), `model`, `latency_ms`, `cost_usd`. `domain_correction_needed` score set based on whether raw ≠ corrected (REQ-observability-005).
- [ ] **Image branch** — Nodes **"Descargar media"** and **"Vision Análisis"**: download binary + GPT-4o Mini vision call with SP-03 injected with finca context and caption. Span `vision_analisis` logged with all required fields.
- [ ] Node **"Preparar texto final"**: merges prior `contexto_parcial` (if continuation turn) + current input (post-corrected text / vision output + caption / raw text). `es_continuacion` flag set.
- [ ] Node **"LLM Extracción"**: GPT-4o Mini call with SP-01 injected with `{{LISTA_LOTES}}`, `{{FINCA_NOMBRE}}`, `{{CULTIVO_PRINCIPAL}}`, `{{PAIS}}`. Output validated against expected JSON schema — schema violation → log + fallback nota_libre. Span `llm_extraccion` logged with ALL required fields: `input_raw` (full prompt), `output`, `model`, `tokens_input`, `tokens_output`, `latency_ms`, `cost_usd`, `confidence_score` map (not aggregated — REQ-observability-003). **SP-01 must contain null-first instruction verbatim (R1)**.
- [ ] Node **"Validar completitud"**: per-tipo_evento field criticality check per REQ-extraction-003. If all critical fields null AND confidence < 0.3 → immediate nota_libre (skip clarification — REQ-extraction-007). Span `validar_completitud` logged with `resultado`, `campos_faltantes`, `completeness_score`.
- [ ] Node **"Gestión de clarificación"**: Check `clarification_count`. If < 2: ask ONE question (highest priority missing field: lote_id first, then type-specific — REQ-conversation-006). UPDATE `sesiones_activas` SET `clarification_count = count + 1`, `contexto_parcial = extraction_result`, `ultimo_mensaje_at = NOW()`, `expires_at = NOW() + INTERVAL '30 minutes'`. Send clarification question via Meta API. END flow (wait for next user message). Span `clarification_turn_{n}` logged. If >= 2: FALLBACK → nota_libre path.
- [ ] Node **"Persistir evento"**: INSERT `eventos_campo` with `descripcion_raw` ALWAYS populated (never null — REQ-persistence-001), `datos_evento` JSONB with canonical structure per tipo_evento (all keys present, missing fields as explicit null — REQ-persistence-007), confidence scores stored in `datos_evento._confidence`. UPDATE `mensajes_entrada` `status='processed'`, `evento_id=new_evento_id`. Span `persistir_evento` logged. No DELETE at any point (REQ-persistence-004).
- [ ] Node **"Registrar costo WhatsApp"**: INSERT `wa_message_costs` for inbound message (direction='inbound', cost_usd=0) and for each outbound message (ack, clarification, confirmation). REQ-persistence-006.
- [ ] Node **"Confirmar al usuario"**: send confirmation message. Max 3 lines, tuteo, no prohibited vocabulary. Emojis ✅ for complete, ⚠️ for requires_review.
- [ ] Node **"Cerrar traza LangFuse"**: scores `confidence_score`, `completeness_score`, `requiere_validacion` attached before closing (REQ-observability-005). Audio traces: `domain_correction_needed` set. `wer_score` and `audio_quality` set to null (for human annotation later). Trace closed regardless of success or failure.
- [ ] Every error path has a LangFuse error event logged BEFORE the graceful handler runs (REQ-observability-004). No silent catch blocks.
- [ ] SC-conversation-005 verified: send 2 messages — first triggers clarification, then send a completely different second report. Verify: first event → nota_libre in DB, second event → processed fresh.
- [ ] Tested with SD-01 (text happy path): `eventos_campo` row created, `mensajes_entrada` status='processed', LangFuse trace visible with all required spans
- [ ] Tested with SD-02 (audio): STT spans visible in LangFuse, audio stored in `audio-eval/` bucket (if within first 30)
- [ ] Tested with SD-03 (image without caption): clarification sent, continuation merges context
- [ ] Tested with SD-04 (2 clarifications → fallback): nota_libre created, no third question ever sent
**Notes**: R2 constraint — `clarification_count` check is the single authoritative gate for the 2-question limit. This logic must read from the DB record, not from n8n session variables. R4 — every error path must have a LangFuse event. The SC-conversation-005 deterministic session-close behavior is MANDATORY — implement it as an explicit branch at the "Buscar sesión activa" node output, not as a heuristic.

---

### T-FLOW-04: flujo-04-reporte-semanal
**Spec refs**: REQ-persistence-006 (cost tracking for templates), REQ-observability-001 (LangFuse span)
**Design refs**: flujo-04 node contracts table, SD section in design.md
**File(s)**: `flows/flujo-04-reporte-semanal.json`
**Done when**:
- [ ] n8n workflow created with name "flujo-04-reporte-semanal"
- [ ] Cron trigger configured: lunes 6:00 AM hora Ecuador (UTC-5 → 11:00 UTC)
- [ ] Node **"Obtener fincas activas"**: SELECT `fincas` JOIN `eventos_campo` WHERE `created_at > NOW() - INTERVAL '7 days'` GROUP BY finca having COUNT > 0. Returns list with `finca_id`, `nombre`, `cultivo`, `gerente_phone` (from `usuarios` WHERE `rol IN ('gerente','propietario')`). DB error: log to LangFuse, abort entire run.
- [ ] Node **"Agregar eventos por finca"**: per finca, SELECT `eventos_campo` for last 7 days grouped by `tipo_evento` and `lote_id`. Aggregate: counts, sums, list of requires_review events. Skip finca if DB error (log per-finca).
- [ ] Node **"Generar resumen IA"**: GPT-4o Mini with SP-05 injected with aggregated data. Span `reporte_semanal_{finca_id}` in LangFuse. Error fallback: generate tabular summary without LLM (no AI text, just formatted counts).
- [ ] Node **"Enviar a gerente"**: POST to Meta Cloud API. If within 24h window → free text message. If outside → use approved template. INSERT `wa_message_costs` with actual cost (template vs. free).
- [ ] Node **"Registrar envío"**: INSERT `wa_message_costs` (direction='outbound', message_type='template' or 'text', cost_usd as applicable).
- [ ] Error handling: Meta API failures → retry x3 with exponential backoff. After 3 failures: log to LangFuse, no user escalation (H0). No events where result is not empty — if no events in week, skip finca entirely (no "no activity" message).
- [ ] Tested manually by triggering the workflow against a test finca with sample events: resumen message sent to gerente phone
**Notes**: R4 constraint — LangFuse span `reporte_semanal_{finca_id}` must be present for each finca processed. R5 — this is H0 scope only: no complex routing logic, no personalization beyond finca context.

---

## Phase 5 — Integration Testing

### T-TEST-01: E2E texto completo → evento persistido
**Spec refs**: SC-webhook-001, SC-extraction-001, SC-persistence-001, SC-observability-001
**Design refs**: SD-01 (full happy path sequence)
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Setup: one fully onboarded finca (F001) with 3 lotes exists in DB
- [ ] Send POST to webhook with text payload: "Apliqué 5 bombadas de Mancozeb en el lote de arriba"
- [ ] Verify: HTTP 200 returned immediately
- [ ] Verify: `mensajes_entrada` row created with `status='received'`, then updated to `status='processed'`
- [ ] Verify: `eventos_campo` row created with `tipo_evento='insumo'`, `lote_id='F001-L01'` (resolved), `confidence_score >= 0.8`, `descripcion_raw` = original text
- [ ] Verify: WhatsApp confirmation message sent (via Meta API mock or Wati sandbox)
- [ ] Verify: LangFuse trace `whatsapp_message_{wamid}` exists with all required spans: `autenticar_usuario`, `verificar_consentimiento`, `llm_extraccion`, `validar_completitud`, `persistir_evento`
- [ ] Verify: LangFuse trace scores: `confidence_score > 0.8`, `completeness_score = 1.0`, `requiere_validacion = false`
**Notes**: R4 requirement — the test fails if LangFuse trace is missing or incomplete.

---

### T-TEST-02: E2E audio → STT → evento persistido + eval storage
**Spec refs**: SC-extraction-001, SC-persistence-003 (DA-08), SC-observability-001
**Design refs**: SD-02 (audio processing sequence)
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Send audio message payload (use real .opus test file or Meta media mock) with content "Hoy chapié el lote de abajo con 3 jornales"
- [ ] Verify: ack "Estoy procesando tu reporte..." sent BEFORE STT download begins
- [ ] Verify: Supabase Storage bucket `audio-eval/` contains `{wamid}.opus` file (if within first 30)
- [ ] Verify: `mensajes_entrada.media_ref` = storage path or media_id
- [ ] Verify: `mensajes_entrada.contenido_raw` = post-corrected transcription
- [ ] Verify: `eventos_campo` created with `tipo_evento='labor'`, correct `lote_id`, `num_trabajadores=3`
- [ ] Verify: LangFuse trace contains ALL audio-path spans: `descargar_media`, `stt_transcripcion`, `stt_post_correccion`, `llm_extraccion`, `validar_completitud`, `persistir_evento`
- [ ] Verify: `domain_correction_needed` score set (true or false based on whether correction occurred)
- [ ] Verify: `wer_score` and `audio_quality` fields present as null in trace (ready for human annotation)
- [ ] Verify: if this was within first 30 audios, trace tagged `dataset='audio-eval-h0'`

---

### T-TEST-03: E2E imagen sin caption → clarificación → evento
**Spec refs**: SC-extraction-005, SC-conversation-001, SC-observability-004
**Design refs**: SD-03 (image without caption sequence)
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Send image message payload (test JPEG, no caption) to webhook
- [ ] Verify: vision analysis LangFuse span created
- [ ] Verify: `lote_id=null` detected, clarification question sent: "¿En qué lote tomaste la foto?"
- [ ] Verify: `sesiones_activas` row created with `clarification_count=1`, `tipo_sesion='reporte'`, `contexto_parcial` contains partial extraction
- [ ] Send follow-up text message "en el lote 3" as continuation
- [ ] Verify: session found, `contexto_parcial` merged, extraction completes with `lote_id` resolved
- [ ] Verify: `eventos_campo` persisted with correct `lote_id`
- [ ] Verify: session closed with `status='completed'`
- [ ] Verify: multi-turn LangFuse trace contains `clarification_turn_1` span with field asked and question text

---

### T-TEST-04: E2E 2 clarificaciones → fallback nota_libre
**Spec refs**: SC-conversation-003, REQ-conversation-002, REQ-conversation-003
**Design refs**: SD-04 (2 clarifications → fallback sequence)
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Send ambiguous text "Hoy fumigamos" to webhook
- [ ] Verify: `clarification_count=1` in `sesiones_activas`, clarification question sent
- [ ] Reply "Con Mancozeb" — event still incomplete (no lote)
- [ ] Verify: `clarification_count=2`, second clarification question sent
- [ ] Reply "por ahí" — event still incomplete
- [ ] Verify: `eventos_campo` created with `tipo_evento='nota_libre'`, `status='requires_review'`
- [ ] Verify: `datos_evento.extraccion_parcial` contains the partial extraction context
- [ ] Verify: `descripcion_raw` contains all concatenated user inputs ("Hoy fumigamos... Con Mancozeb... por ahí")
- [ ] Verify: user received "Lo registro como nota y lo revisamos después."
- [ ] Verify: no fourth message ever sent (hard limit enforced)
- [ ] Verify: `sesiones_activas` record closed with `status='fallback_nota_libre'`

---

### T-TEST-05: SC-conversation-005 — nueva reporte con sesión pendiente (MUST)
**Spec refs**: SC-conversation-005 (explicitly marked MUST in task constraints)
**Design refs**: flujo-02 "Buscar sesión activa" node, session-close deterministic behavior
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Setup: send ambiguous message "Apliqué algo" → clarification pending, `clarification_count=1`, session active
- [ ] WITHOUT replying to clarification, send a completely different message: "cosecha de 20 quintales en el lote 3"
- [ ] Verify: the PENDING session is AUTOMATICALLY closed as `fallback_nota_libre`
- [ ] Verify: the abandoned incomplete event is persisted as `nota_libre` with `status='requires_review'`
- [ ] Verify: the new cosecha message is processed as a FRESH session with `clarification_count=0`
- [ ] Verify: `eventos_campo` for cosecha is created correctly (if all fields present)
- [ ] Verify: behavior is DETERMINISTIC — not dependent on message timing or content heuristics
**Notes**: This test validates the SC-conversation-005 MUST requirement. The session-close logic must be implemented as an explicit branch at "Buscar sesión activa" output — the presence of ANY active session when a new message arrives (that is NOT a clarification reply to the pending session) MUST trigger the automatic close.

---

### T-TEST-06: E2E onboarding completo (5 pasos)
**Spec refs**: SC-onboarding-001, REQ-onboarding-002, REQ-onboarding-003, REQ-onboarding-004
**Design refs**: SD-05 (onboarding sequence)
**File(s)**: N/A (test execution)
**Done when**:
- [ ] Send "Hola" from a phone number NOT in `usuarios`
- [ ] Verify: flujo-03 triggered, welcome message sent
- [ ] Reply with "Juan, agricultor" — verify `usuarios` row created with `onboarding_completo=false`
- [ ] Verify: consent text sent VERBATIM (matches SP-04 step 2 exact text)
- [ ] Reply "Sí acepto" — verify `user_consents` row created with `aceptado=true`, `texto_mostrado` = full consent text
- [ ] Reply farm data "Finca La Esperanza, Los Ríos, cacao" — verify `fincas` row created
- [ ] Reply lot list "el de arriba, el del río y el nuevo" — verify 3 `lotes` rows created with correct `nombre_coloquial`, `lote_id` format F001-L01/L02/L03
- [ ] Verify: system sends lot confirmation list; reply "sí, está bien"
- [ ] Verify: `usuarios.onboarding_completo=true`, activation message sent
- [ ] Verify: LangFuse trace `onboarding_{phone_hash}` exists and is closed
- [ ] Verify: user can now send reports (flujo-02 accessible for this phone)

---

### T-TEST-07: Verificar LangFuse — trazas completas en todos los paths
**Spec refs**: REQ-observability-001 through REQ-observability-006
**Design refs**: LangFuse integration design in design.md
**File(s)**: N/A (verification in LangFuse UI)
**Done when**:
- [ ] Review LangFuse UI after T-TEST-01 through T-TEST-06 are complete
- [ ] Confirm ALL text message traces contain EXACTLY: `autenticar_usuario`, `verificar_consentimiento`, `llm_extraccion`, `validar_completitud`, `persistir_evento` spans
- [ ] Confirm ALL audio message traces contain ADDITIONALLY: `descargar_media`, `stt_transcripcion`, `stt_post_correccion`
- [ ] Confirm ALL image message traces contain ADDITIONALLY: `descargar_media`, `vision_analisis`
- [ ] Confirm multi-turn traces contain `clarification_turn_1` (and `_2` where applicable)
- [ ] Confirm ALL spans have `latency_ms`, `cost_usd`, `input_raw`, `output`, `model` populated (never null)
- [ ] Confirm ALL closed traces have scores: `confidence_score`, `completeness_score`, `requiere_validacion`
- [ ] Confirm no trace is left in "pending/open" state after pipeline completes
- [ ] Confirm nota_libre traces have `completeness_score=0` or appropriate low value, `requiere_validacion=true`

---

### T-TEST-08: Verificar RLS — aislamiento entre fincas
**Spec refs**: REQ-persistence-003, SC-persistence-001
**Design refs**: RLS policies in 01-schema-core.sql
**File(s)**: N/A (verification in Supabase or via test HTTP calls)
**Done when**:
- [ ] Setup: 2 users with different fincas — Finca F001 (user A) and Finca F002 (user B)
- [ ] Insert test events for both fincas via service_role
- [ ] Authenticate as user A (JWT for user A's `auth.uid()`)
- [ ] `SELECT * FROM eventos_campo` — verify ONLY F001 events returned
- [ ] `SELECT * FROM fincas` — verify ONLY F001 record returned
- [ ] `SELECT * FROM lotes` — verify ONLY F001 lotes returned
- [ ] Authenticate as user B, verify symmetric isolation (only F002 data visible)
- [ ] Verify: service_role key (used by n8n) can SELECT and INSERT across both fincas (RLS bypass)
**Notes**: This test is the P5 enforcement check. Cross-farm data leakage is an unacceptable H0 failure. Run this test before onboarding any real users.

---

## Dependency Graph

```
Phase 1 (SQL — must run in order):
  T-SQL-01 → T-SQL-02 → T-SQL-03 → T-SQL-04 → T-SQL-05 → T-SQL-06

Phase 2 (System Prompts — can run in parallel after T-SQL-01):
  T-SQL-01 ──┬─→ T-PROMPT-01
              ├─→ T-PROMPT-02
              ├─→ T-PROMPT-03
              ├─→ T-PROMPT-04
              └─→ T-PROMPT-05

Phase 3 (LangFuse — can start after T-SQL-01, parallel with Phase 2):
  T-SQL-01 → T-LANGFUSE-01

Phase 4 (Flows — all SQL + prompts + LangFuse must be done first):
  T-SQL-01..06 + T-PROMPT-01..05 + T-LANGFUSE-01
    → T-FLOW-01 (flujo-01)
    → T-FLOW-02 (flujo-03 onboarding) — MUST be done before T-FLOW-03
    → T-FLOW-03 (flujo-02 core pipeline) — depends on T-FLOW-01 + T-FLOW-02
    → T-FLOW-04 (flujo-04 semanal) — can run in parallel with T-FLOW-02/T-FLOW-03

Phase 5 (Testing — all Phase 4 tasks must be complete):
  T-FLOW-01..04 → T-TEST-01 → T-TEST-02 → T-TEST-03 → T-TEST-04
                → T-TEST-05 (SC-conversation-005 MUST — can run after T-TEST-01)
                → T-TEST-06 (onboarding — can run after T-FLOW-02)
                → T-TEST-07 (LangFuse audit — after T-TEST-01..06)
                → T-TEST-08 (RLS — after T-SQL-01 + any test data)

Critical path:
  T-SQL-01 → T-SQL-02 → T-SQL-03 → T-SQL-04 → T-LANGFUSE-01
  + T-PROMPT-01..04 → T-FLOW-02 → T-FLOW-03 → T-TEST-05
```
