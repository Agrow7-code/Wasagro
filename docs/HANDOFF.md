# Wasagro — Handoff técnico: estado de la rama y plan de mejora

> Documento de revisión para la rama `claude/infrastructure-security-audit-quk6jl` (PR #4).
> Distingue lo **ya implementado** (a revisar) de lo que **falta** (priorizado, paso a paso).
> Audiencia: revisor/experto que lleva Wasagro a nivel de startup de calidad.

## Contexto

Sistema AI-first de captura de campo agrícola vía WhatsApp (voz/texto/imagen) → IA estructura → reportes/alertas. Horizonte **H0-R**: primera finca pagante. Métrica norte: eventos correctamente estructurados con accuracy ≥85%. Principio rector: **P1 — el agente nunca inventa datos** (en agricultura un error tiene costo económico real e irreversible).

**Stack:** Hono+TypeScript en Railway · Supabase (Postgres/PostGIS/RLS) · router LLM multi-modelo (Gemini primario + Groq/NVIDIA) · Deepgram STT · LangFuse observabilidad · Evolution API (WhatsApp) · frontend Vite/React en Vercel.

**Verificación rápida del estado:** `npm ci && npm run typecheck && npm test` con env dummy (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `JWT_SECRET` ≥32 bytes, `DATABASE_URL`, `WHATSAPP_PROVIDER=evolution`, `EVOLUTION_*`). Estado: **typecheck limpio, 731 tests verdes**. Migraciones 059 y 060 validadas contra Postgres 16 real.

---

## PARTE A — Ya implementado en esta rama (revisar y validar)

### A1. Seguridad en 4 capas (ADR 018, D31, `docs/runbooks/security-audit-2026-06.md`)

1. **Webhooks de pago (era CRÍTICO):** dLocal Go y DeUna no verificaban firma → cualquiera activaba/cancelaba suscripciones de cualquier organización. Fix en `src/index.ts` + `src/integrations/webhookSecurity.ts` (token en `notification_url` + HMAC, fail-closed 503). **Revisar:** que el esquema coincida con lo que realmente envía cada proveedor.
2. **Cross-tenant (era ALTO):** `org_id` en el JWT (`src/auth/jwtService.ts`) + `requireFincaAccessAsync` (`src/auth/middleware.ts`) acota `admin_org` a su org; `director` global. Call sites en `src/agents/finca/router.ts` y `src/agents/metricas/router.ts`.
3. **Rate limiter fail-closed** en auth (`src/auth/rateLimiter.ts`).
4. **Ruta `api/auth/*.ts`:** quitado CORS `*`+credentials y enumeración por 404.
5. **BD (migración 058):** `v_eventos_analisis` con `security_invoker`; guard en `buscar_eventos_similares`; fix en `get_fincas_con_coordenadas`; `search_path` pineado en funciones SECURITY DEFINER.
6. **Infra:** LangFuse bind `127.0.0.1`; Supabase `ssl_enforcement=true` + `minimum_password_length=8`; gate `author_association` en `claude.yml`; security headers en `landing/vercel.json`; `infrastructure/langfuse/Caddyfile.example`.
7. **Frontend:** `Authorization` en todas las vistas (`landing/src/auth/api.ts`); sin `?phone=`; PII fuera de logs (`src/integrations/logRedact.ts`); Vite borra `console.*` en prod.

### A2. Calidad LLM / anti-alucinación

1. **`temperature: 0` (1.1):** fijado en ReAct, V2VK, visión, OCR, 4 pasadas Sigatoka, resumen, STT post-corrección (`WasagroAIAgent.ts`). Gemini default era 0.7. `redactarMensajeSDR` queda creativo a propósito.
2. **Filtro de confianza (1.2):** `src/integrations/llm/confidenceFilter.ts` (puro, 7 tests). Anula campos con confianza <0.3 y marca `requiere_validacion`; score global <0.5 → revisión (nunca descarta). Convierte P1 en garantía de código.
3. **Routing por capacidad de tools (1.4):** `ILLMAdapter.supportsTools`; el router enruta peticiones con tools solo a adapters tool-capaces (solo Gemini); falla explícito si ninguno disponible (`LLMRouter.ts`, +4 tests). Antes caía a NVIDIA que ignoraba las tools en silencio.
4. **`MODEL_PRICING` (4.5):** Gemini con precios oficiales; `gemini-2.5-flash` subcontaba ~8x (corregido); modelo desconocido emite warning en vez de $0 silencioso (`LLMCallCostService.ts`). NVIDIA NIM = estimación a verificar.

### A3. Correctitud de orquestación

- **Barrera de intenciones atómica (3.1, migración 059):** read-modify-write no atómico sobre `sesiones_activas` → con workers concurrentes se pisaban (lost update) y `todas_completas` no disparaba. Ahora RPC `marcar_intencion_estado` con `SELECT ... FOR UPDATE`. Validado en Postgres real (test de concurrencia + bordes). EXECUTE solo `service_role`.

### A4. Observabilidad para medir

- **Migración 060:** `generation_name` en `llm_call_costs` → desglose por prompt (antes solo por modelo/tier). 5 call sites actualizados.
- **`docs/runbooks/llm-cost-analysis.sql`:** 7 queries read-only (volumen, por-prompt, por tier p50/p95, por modelo, modelos en $0, costo por mensaje, por org). Validadas en Postgres real.

---

## PARTE B — Falta hacer (priorizado)

### P0 — Operativo, pre-lanzamiento

1. Setear `DLOCALGO_WEBHOOK_SECRET` y `DEUNA_WEBHOOK_SECRET` en Railway + panel del proveedor; probar cobro real e2e.
2. Completar `allowed_cidrs` de Supabase con IPs reales de egress.
3. LangFuse: desplegar proxy TLS (Caddyfile) + rol `langfuse_app` mínimo en vez de superusuario.
4. Verificar el esquema de firma real de dLocal/DeUna y ajustar `webhookSecurity.ts` si difiere.

### P1 — Medición de contexto/prompts

5. Desplegar migración 060; dejar acumular datos con `generation_name`.
6. Correr `docs/runbooks/llm-cost-analysis.sql`. Query 0 = ¿hay volumen? (en H0-R puede haber poca data → "instrumentado, medir tras lanzar"). Query 1 = prompt más pesado en tokens de entrada.
7. Atacar el prompt/tier que los datos señalen.

### P2 — Anti-alucinación y latencia

8. **ReAct multi-turno:** hoy concatena `conversationHistory` como string y reenvía el systemPrompt cada iteración. Migrar a `contents`/roles de Gemini (menos tokens, mejor separación).
9. **Hedged requests en el router:** falla en secuencia (20s timeout antes de probar el siguiente). Lanzar primario y disparar secundario si no responde en ~p50; quedarse con el primero (corta p99).
10. **Separar presupuesto del ReAct:** 3 iteraciones compartidas entre tool-calls y retries Zod. Separar + cachear tool-calls dentro de un mensaje.
11. **Few-shot en extractores** (`sp-01a..i`): construir ejemplos input→JSON desde los `requires_review` corregidos. *Agrega* contexto a propósito (contexto relevante, no menos).
12. **Tool-calling en un adapter de fallback** (Qwen/Groq reasoning) para no depender solo de Gemini.
13. **Error routing del router:** clasifica por substring (`includes('50')`); usar códigos estructurados.
14. **Verificador cruzado** en plaga/dosis (generalizar el checksum de Sigatoka).

### P3 — Delegación de agentes / limpieza

15. **Consolidar clasificador duplicado** (`IntentGate` vs `#clasificar` interno en `WasagroAIAgent.ts`); eliminar el path muerto.
16. **Estado de salud por org/tier:** `consecutive429Count`/`activeThreads` globales → una org ruidosa throttlea a todas.
17. **Throttle dinámico real:** `maxThreads` se muta pero `localConcurrency` ya quedó fijado al registrar el worker (`pgBoss.ts`) → no surte efecto.
18. **Agente supervisor/planner:** decidir ReAct completo vs extractor simple; dependencias entre intenciones.
19. **Sync de prompts:** el script `prompts:sync` no aparece en el repo → prompts probablemente desde disco, versionado LangFuse inerte.

### P4 — Datos y dashboard (mayor ROI de producto)

20. **Cablear lo huérfano:** `landing/src/dashboard/modules/Calculadora.tsx` (API real) no está importado — la ruta sirve `CalculadoraView.tsx` (mock); cambiar el import. `v_eventos_analisis` + `PlagasModule`/`CostosModule` no se consultan nunca → conectarlas.
21. **13 de 16 vistas son mock** (`landing/src/dashboard/mock/data.ts`): reemplazar por datos reales vista por vista (reales: Billing, FincaSetup, SigatokaRevision).
22. **RBAC real:** `ProtectedRoute` solo chequea auth; `useRole()` decide por URL, no por `user.rol` → cualquiera entra a `/dashboard/exportadora`. (También hallazgo de seguridad.)
23. **Librería de gráficos** (no hay): Recharts/visx/Tremor con series temporales, ejes, tooltips, export.
24. **Analítica como tendencia + reporte exportable** (PDF/email): hoy todo sale por WhatsApp efímero; links "Reportes" del sidebar muertos.

### P5 — Flywheel de calidad (lo YC-grade)

25. **Harness de evaluación:** dataset desde los `requires_review` corregidos (D30 ya los genera), corrido en CI contra cada cambio de prompt/modelo. Bucle: correcciones humanas → evals → few-shots → mejor modelo → menos correcciones.

### P6 — Higiene

26. JWT 7d sin revocación → `jti`/`token_version` (logout remoto).
27. CAPTCHA tras N fallos OTP.
28. `change-plan` como propuesta pendiente de pago (no concede acceso activo; ensucia P&L).
29. Política explícita `storage.objects` para `eventos-media`.
30. NO desplegar `wasagro-login.html` (prototipo, OTP demo hardcodeado).
31. `npm audit` en CI. **NO remover `openai`** (se usa para embeddings NVIDIA, D12).

---

## Cautelas (decisiones deliberadas, no bugs)

- **RLS no es la barrera real hoy:** backend usa `service_role` (bypass RLS). Enrutar por cliente user-scoped no funciona tal cual porque los JWT se firman con `JWT_SECRET` propio, no con el secreto de Supabase Auth → `auth.uid()` no resuelve. Migrar a JWT compatible con Supabase Auth es trabajo arquitectónico. Hoy el aislamiento lo dan `requireFincaAccessAsync` + funciones/políticas endurecidas.
- **Cookie httpOnly + CSRF:** diferido a propósito — Bearer-en-header no es CSRF-vulnerable; migrar a cookie *introduce* superficie CSRF. El CSP mitiga el XSS que habilitaría el robo.
- **Falsos positivos descartados:** OTP ya hasheado (bcrypt); `openai` se usa; `change-plan` no concede acceso activo.
- **Sobre el contexto:** medir antes de recortar. Las reglas de dominio/glosario *reducen* alucinación — objetivo es "contexto justo", no "menos contexto".
