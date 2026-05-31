# AGENT-CONTEXT — Wasagro

> **Contexto base para todos los agentes IA que trabajan en este repo.**
> Cargado al inicio de cada sesión. Leer completo antes de tocar código.
>
> **Este archivo NO es AGENTS.md.** `AGENTS.md` (raíz) son las reglas FAIL/PASS que GGA aplica en cada commit — no se toca. Este archivo es el *primer arquitectónico* que orienta a un agente nuevo (humano o IA) sobre cómo está construido el sistema.

---

## 1. Qué es Wasagro

Agente WhatsApp AI-first que convierte mensajes de campo (voz, texto, imagen) en datos estructurados para fincas de exportación en LATAM. El canal es WhatsApp porque es el contrato social del campo latinoamericano — no es decisión técnica, es de producto inamovible.

**Principio rector:**
> El LLM nunca toma decisiones de flujo. Solo produce texto dado un contexto y una rama ya decididos por código. (ADR-009)

Determinismo donde se pueda. LLM solo donde haga falta.

---

## 2. Stack técnico real (verificado contra CLAUDE.md Capa 3)

| Capa | Tecnología | Decisión |
|---|---|---|
| Runtime | Node.js + TypeScript strict (sin `any`) | — |
| Canal WhatsApp | **Evolution API self-hosted en Railway** | D6 |
| Cola de mensajes | **pg-boss** con `singletonKey` para dedupe | D10 |
| Base de datos | **Supabase (PostgreSQL + PostGIS + JSONB)** con RLS por `org_id` | D1 |
| Backend | **Hono + TypeScript en Railway** (NO Vercel — Vercel solo sirve la landing) | D2 |
| LLM router tiered | **Gemini 2.5 Flash + Groq Llama 3.3 70B + NVIDIA (Nemotron/Gemma/Minimax)** | D3, D11 |
| Tier OCR dedicado | **`nvidia/nemotron-ocr-v1` primario, Kimi K2 / DeepSeek OCR fallback** | D11 |
| STT | **Deepgram nova-2-general** (`language: 'multi'`) | D4 |
| Observabilidad | **LangFuse self-hosted** | D5 |
| Scheduler | **node-cron** en `src/index.ts` para reportes/alertas | D14, D19, D20 |
| Auth dashboard | **OTP via WhatsApp + JWT 7d** | D22 |
| Embeddings RAG | `EmbeddingService` ([EXISTE HOY] en `src/integrations/llm/EmbeddingService.ts`) | D12 |

**Costos H0:** ver `CLAUDE.md` (Supabase Pro $25 + Railway uso variable). No usar números sin source verificado.

**Tecnologías NO vigentes:** la tabla de arriba es la fuente única. Cualquier tecnología no listada (otros proveedores WhatsApp, otros LLMs, otra STT, otras nubes) **no está en uso**. Si dudás de por qué se descartó algo específico, leer `CLAUDE.md` Capa 3 — las decisiones D1-D22 explican cada elección y qué reemplazó.

---

## 3. Estructura del repo — paths reales con estado

Convención de etiquetas:
- `[EXISTE HOY]` → vive en disco, importable directamente
- `[FASE X — pendiente]` → será creado por el refactor ADR-009 fase X
- `[DEPRECATED]` → existe pero candidato a borrar

### Pipeline de campo
```
src/index.ts                                  [EXISTE HOY]  bootstrap + Hono + crons
src/webhook/router.ts                         [EXISTE HOY]  POST /webhook/whatsapp + dedupe wamid
src/pipeline/procesarMensajeEntrante.ts       [EXISTE HOY]  router por usuario (SDR / onboarding / event)
src/pipeline/handlers/EventHandler.ts         [EXISTE HOY]  flow de evento de campo
src/pipeline/handlers/OnboardingHandler.ts    [EXISTE HOY]  admin + agricultor onboarding
src/pipeline/sttService.ts                    [EXISTE HOY]  Deepgram wrapper
src/pipeline/procesarExcel.ts                 [EXISTE HOY]  Excel/CSV pipeline
src/pipeline/promptInjector.ts                [EXISTE HOY]  template var injection con escape {{}}
src/pipeline/promptManager.ts                 [EXISTE HOY]  load/cache de prompts
```

### Workers
```
src/workers/pgBoss.ts                         [EXISTE HOY]  init + worker procesar-intencion + sdr-chaser
src/workers/sdrChaserWorker.ts                [EXISTE HOY]  follow-up 20h
```

### Auth y seguridad
```
src/auth/router.ts                            [EXISTE HOY]  /auth/request-otp + /verify-otp + /me
src/auth/jwtService.ts                        [EXISTE HOY]  HS256 + iss/aud + 32 bytes min secret
src/auth/middleware.ts                        [EXISTE HOY]  authMiddleware + requireFincaAccess + getUserSupabase
src/auth/otpService.ts                        [EXISTE HOY]  crypto.randomInt + bcrypt hash
src/auth/rateLimiter.ts                       [EXISTE HOY]  Supabase RPC rate_limit_hit (no in-memory)
src/integrations/ssrfProtection.ts            [EXISTE HOY]  async + DNS resolve + IPv4-mapped IPv6
src/integrations/timedFetch.ts                [EXISTE HOY]  AbortController real
src/integrations/supabase.ts                  [EXISTE HOY]  service + createUserScopedClient(jwt)
```

### LLM y agentes
```
src/integrations/llm/IWasagroLLM.ts           [EXISTE HOY]  contrato de la fachada LLM
src/integrations/llm/WasagroAIAgent.ts        [EXISTE HOY]  implementación de todas las skills LLM
src/integrations/llm/IntentGate.ts            [EXISTE HOY]  classifier de intenciones del pipeline event
src/integrations/llm/LLMRouter.ts             [EXISTE HOY]  router tiered (fast/reasoning/ultra/ocr)
src/integrations/llm/GeminiAdapter.ts         [EXISTE HOY]
src/integrations/llm/GroqAdapter.ts           [EXISTE HOY]
src/integrations/llm/NvidiaAdapter.ts         [EXISTE HOY]  ultra + OCR tier
src/integrations/llm/OllamaAdapter.ts         [EXISTE HOY]  fallback local
src/integrations/llm/EmbeddingService.ts      [EXISTE HOY]
src/agents/orchestrator/IntentDetector.ts     [EXISTE HOY]  intent del pipeline event (no SDR)
src/agents/rag/RAGRetriever.ts                [EXISTE HOY]  RAG sobre eventos de la finca
src/agents/mcp/SupabaseTools.ts               [EXISTE HOY]  ReAct tools (lectura) D17
src/agents/sdrAgent.ts                        [EXISTE HOY]  handleSDRSession + handleMeetingConfirmation
src/agents/sdr/router.ts                      [EXISTE HOY]  FSM SDR (triage → discovery → pitch → close)
src/agents/finca/router.ts                    [EXISTE HOY]  endpoints dashboard /api/finca
src/agents/metricas/router.ts                 [EXISTE HOY]  endpoints dashboard /api/metricas
```

### Refactor ADR-009 (pendiente)
```
src/constants/intents.ts                      [FASE B — pendiente]  Zod enum único compartido FSM + classifier
src/agents/sdr/context.ts                     [FASE C — pendiente]  ConvContext schema + reduceContext puro
src/agents/sdr/classifier.ts                  [FASE B — pendiente]  clasificarIntent unificado + retry-with-feedback
src/agents/sdr/composer.ts                    [FASE A — pendiente]  resuelve template por fsmState
src/agents/sdr/skills/registry.ts             [FASE A — pendiente]  index estado/action → template
src/agents/sdr/skills/templates/              [FASE A — pendiente]  un archivo por mensaje estructural
src/agents/sdr/skills/objections/             [FASE A — pendiente]  un archivo por tipo de objeción
src/agents/sdr/validators.ts                  [FASE D — pendiente]  pipe con smart auto-fix
src/agents/sdr/metrics.ts                     [FASE D — pendiente]  wrapper Langfuse para alertas
tests/agents/sdr/context.test.ts              [FASE C — pendiente]  ≥20 casos del reducer
```

### Tests (path real del repo: `tests/`)
```
tests/auth/middleware.test.ts                 [EXISTE HOY]  9/9 passing
tests/agents/                                 [EXISTE HOY]
tests/pipeline/                               [EXISTE HOY]
tests/integrations/                           [EXISTE HOY]
```

### Migraciones y prompts
```
supabase/migrations/2026XXXXXX_*.sql          [EXISTE HOY]  numeradas por timestamp
prompts/sp-XX-*.md                            [EXISTE HOY]  system prompts del agente de campo
sdr/prompts/SP-SDR-XX-*.md                    [EXISTE HOY]  system prompts del SDR
infrastructure/langfuse/                      [EXISTE HOY]  LangFuse self-hosted
```

---

## 4. Vocabulario del dominio — LEER ANTES DE GENERAR CÓDIGO

### Entidades principales (jerarquía: Org → Finca → Lote → Evento)

| Término | Definición | Nunca confundir con |
|---|---|---|
| `organización` | Exportadora, cooperativa, o ONG — el pagador B2B | El agricultor (que no paga) |
| `finca` | Unidad productiva con geolocalización. PK `finca_id` TEXT (formato `F001`) | Lote (subdivisión de finca) |
| `finca activa` | Finca con ≥1 evento estructurado en los últimos **30 días** | Finca registrada (puede estar inactiva) |
| `lote` | Subdivisión de una finca. PK `lote_id` TEXT (formato `F001-L01`). Tiene `coordenadas` POINT + `poligono` POLYGON | Finca (nivel superior) |
| `evento de campo` | Registro estructurado en `eventos_campo`. Conserva `descripcion_raw` siempre (P5) | Mensaje (input crudo sin procesar) |
| `evento completo` | Evento con `mandatory_missing = []`, persistido con todos los obligatorios | Evento recibido (puede estar incompleto) |
| `trabajador` | Rol usuario primario. Envía audios/fotos. No toma decisiones del sistema | Jefe de campo (rol distinto) |
| `jefe_finca` / `propietario` | Roles admin a nivel finca | `admin_org` (a nivel organización) |
| `gerente agrícola` | Recibe reportes semanales | Comprador B2B (es la organización pagadora) |
| **NSM** | North Star Metric: **eventos estructurados / semana / finca activa**. Meta H1: ≥5, H2: ≥10 | MRR (métrica de negocio, no de producto) |

### Tipos de evento (ENUM `tipo_evento` en DB)

Source de verdad: `src/types/dominio/EventoCampo.ts` [EXISTE HOY].

```
aplicacion_insumo | deteccion_plaga | cosecha | labor | inspeccion | gasto | clima | otro
```

Severidad de plagas (`leve` / `moderado` / `severo`) — los dos últimos disparan alerta inmediata.

### Roles de usuario

Source de verdad: tabla `usuarios.rol`. Constantes en `src/pipeline/procesarMensajeEntrante.ts:19`:
```ts
export const ROLES_ADMIN = new Set(['propietario', 'jefe_finca', 'admin_org', 'director'])
```

### Vocabulario agronómico
Catálogo canónico en `CLAUDE.md` sección "Glosario de campo" (bombada, caneca, quintal, jornal, escoba, helada de cacao = moniliasis, etc.). Source ahí, no duplicar.

### ⚠️ Errores STT comunes
**No documentar errores STT específicos sin telemetría real.** Cualquier tabla "el STT transcribe X como Y" debe respaldarse con ≥20 transcripciones reales de Deepgram registradas en LangFuse. Si no hay esa muestra, **no inventar ejemplos** — un agente futuro los puede tomar como ground truth.

Cuando se acumule suficiente telemetría, agregar en `docs/runbooks/field/STT-CORRECTIONS.md` con metadata: `samples_validated: N, source: langfuse trace IDs`.

---

## 5. Arquitectura del agente SDR

El SDR es el pipeline de ventas. Opera con prospectos no registrados (sin `usuarios.id`).
El agente de campo (`WasagroAIAgent` + `EventHandler`) es independiente — opera con usuarios registrados.

### Estados y intents
Hoy viven dispersos en `src/agents/sdr/router.ts` y `src/agents/sdrAgent.ts`. **Fase B del refactor consolida en `src/constants/intents.ts` y `src/types/dominio/SDRTypes.ts`** [FASE B — pendiente].

Mientras tanto, ver `src/types/dominio/SDRTypes.ts` [EXISTE HOY] para los types vigentes.

### ConvContext
**Source de verdad única: [ADR-009](decisions/009-llm-decision-audit.md) §"Contrato de `ConversationContext`".**

No duplicar el interface en este archivo. Si necesitás modificarlo, editás el ADR-009 (eso obliga a revisión arquitectónica), después la implementación en `src/agents/sdr/context.ts` [FASE C — pendiente] lo materializa.

### Pipeline por turno (Fase C en adelante)
```
1. msg llega → loadContext(prospectId) → ConvContext desde Supabase + Redis
2. classifier(msg, ctx) → IntentClassification tipada
3. reduceContext(ctx, intent) → newCtx (función pura)
4. fsm.next(newCtx) → { action, brief }
5. composer.render(action, brief, newCtx) → mensaje
6. validators.pipe(mensaje, ctx) → mensaje corregido + telemetría
7. saveContext(newCtx) + sender.enviar(mensaje)
```

---

## 6. Engram protocol — memoria persistente cross-session

El repo usa Engram para conservar decisiones, bugs y aprendizajes **entre sesiones de agentes IA**. No es opcional — es la única vía documentada para que la próxima sesión sepa por qué se tomó una decisión hoy.

### Cuándo usar `mem_save` (proactivo, sin esperar pedido)
- Decisión arquitectónica o de tradeoffs
- Bug fixed con root cause no-obvio
- Convención establecida o patrón nuevo
- Discovery que cambia el modelo mental del sistema
- Config / env var nueva con impacto operativo

### Cuándo usar `mem_search`
- Al inicio de cada sesión, si la tarea toca un dominio ya visto
- Cuando el usuario refiere a "lo que hicimos antes" o equivalente
- Antes de proponer cambios a un módulo con historia

### Topic keys estables (convención del repo)
```
security/{aspecto}                  ej: security/evolution-webhook-auth
sdr/{aspecto}                       ej: sdr/refactor-fase-0-audit
infrastructure/{servicio}           ej: infrastructure/railway-deploy
architecture/{decisión}             ej: architecture/auth-model
```
Mismo topic_key → upsert (no duplica). Distintos → memorias separadas.

### Antipattern de memoria
- ❌ Guardar listas de archivos cambiados (eso vive en git log)
- ❌ Guardar resúmenes de qué hizo Claude (eso vive en transcripts)
- ❌ Snapshots de actividad reciente (decae rápido, ruido)
- ✅ Solo lo que es genuinamente sorprendente o no-obvio del repo actual

---

## 7. Reglas del agente de campo — invariantes de producto

Estas son **principios de diseño**, no configuración. No se sobreescriben con prompts.

| # | Regla | Implementación |
|---|---|---|
| P1 | El agente nunca inventa datos | Confidence < 0.7 → `requiere_validacion: true` |
| P2 | Máximo 2 preguntas de clarificación | `sesiones_activas.clarification_count`, enforced en `pgBoss.ts:107` |
| P3 | Latencia <30s al usuario | Acuse <5s, respuesta completa <30s; webhook responde 200 inmediato, pipeline en background |
| P4 | Todo error LLM/STT se loggea sin excepción | LangFuse `trace.event({level:'ERROR'})` — no `catch{}` vacío |
| P5 | Los datos del campo pertenecen a la finca | `descripcion_raw` siempre se persiste junto al JSON extraído |
| P6 | Consentimiento antes de capturar | Tabla `user_consents` con timestamp y texto exacto |
| P7 | Ninguna acción irreversible sin aprobación humana | DELETE prod, cambios coordenadas, etc. requieren confirmación explícita |

Si tocás código que viole alguna, GGA (`AGENTS.md`) lo bloquea en pre-commit.

---

## 8. Reproduce before fix — disciplina obligatoria

**Antes de cualquier fix, escribir el test que reproduce el bug.** Si no se puede reproducir en test, el fix es especulativo y el bug vuelve a ocurrir.

Caso real: el bug del classifier SDR ("Enviame un PDF" → "no te entendí") se diagnosticó por log post-mortem en lugar de test. Resultado: el fix tardó 2 iteraciones porque la primera no cubría el caso real. Si hubiera existido `tests/agents/sdr/handleMeetingConfirmation.test.ts` con el input literal del cliente, la causa raíz se ve en 5 minutos.

Política:
1. **Bug reportado** → escribir test que lo reproduce ANTES de proponer fix
2. **Test rojo** → confirma que el bug existe y dónde
3. **Fix mínimo** que ponga el test verde
4. **No tocar más** que lo necesario para que verde

Excepción única: bug en producción tirando el servicio (incidente). En ese caso, fix primero + test después + RCA + runbook nuevo (ver `docs/runbooks/incidents/`).

---

## 9. Anti-pattern guards (ADR-009 Anexo C)

Estos 6 grep-checks son la verificación mecánica de que el principio operativo se mantiene. Candidatos a pre-commit hook futuro. Referencia completa: [ADR-009 Anexo C](decisions/009-llm-decision-audit.md#anexo-c-anti-pattern-guards-grep-checks-para-ci).

```bash
# 1. Decisión basada en texto libre del LLM
rg 'JSON\.parse\(.+(redactar|generar)' src/

# 2. Strings de intent hardcoded fuera del enum único
rg "'(wants_brochure|booked|will_book_later|declined|advance|objection)'" src/ --type ts | rg -v 'src/constants/intents.ts'

# 3. Mutación directa de prospecto fuera del reducer
rg 'prospecto\[.+\]\s*=' src/ | rg -v 'src/agents/sdr/context.ts'

# 4. Classifier sin ConvContext
rg 'clasificarIntencionSDR\(' src/ | rg -v 'ConvContext'

# 5. Templates hardcoded en composer
rg 'TEMPLATES\s*=\s*\{' src/agents/sdr/

# 6. Promesas falsas en prompts
rg -i 'casos de éxito|case studies|caso de exito' prompts/ sdr/prompts/
```

Post-Fase E: los 6 deben devolver **0 matches**. Cualquiera con >0 = regresión.

---

## 10. ADRs activos — leer si tocás estos módulos

Source: `docs/decisions/` [EXISTE HOY].

| ADR | Título real (no inventar) | Cuándo leerlo |
|---|---|---|
| [001](decisions/001-hono-over-n8n.md) | Hono over n8n | Antes de tocar arquitectura backend |
| [002](decisions/002-evolution-api-over-meta.md) | Evolution API over Meta | Antes de cambios en canal WhatsApp |
| [003](decisions/003-image-classifier-before-v2vk.md) | Image classifier before V2VK | Pipeline de imágenes |
| [004](decisions/004-evolution-media-download-as-base64.md) | Evolution media download as base64 | Descarga de media de WhatsApp |
| [005](decisions/005-multi-intent-extraction.md) | Multi-intent extraction | IntentGate y subagentes pg-boss |
| [006](decisions/006-initiator-sub-agent-pg-boss.md) | Initiator-subagent + pg-boss | Pipeline de jobs por intención |
| [007](decisions/007-visual-router-ocr-tier.md) | Visual router + OCR tier | OCR con NVIDIA + Zod retry loop |
| [008](decisions/008-react-supabase-live-query.md) | ReAct + Supabase live query | MCP tools del agente |
| [009](decisions/009-llm-decision-audit.md) | LLM decision audit (Fase 0 refactor SDR) | **Cualquier cosa SDR + ConvContext + classifier** |

---

## 11. Lo que NO hacer — anti-patterns que ya costaron tiempo

- ❌ **Agregar reglas al system prompt para corregir bugs estructurales** → el SP se infla, el LLM diluye atención, la regla siguiente lo ignora silenciosamente.
- ❌ **Pasar historial de conversación crudo al classifier** → usar `ConvContext` destilado (ADR-009).
- ❌ **Fallback silencioso en classifiers** → todo `intent = 'other'` debe emitir event LangFuse con el mensaje original. Sin telemetría no se ve la degradación.
- ❌ **Strings literales de estados/intents fuera de `src/constants/`** [FASE B — pendiente] → mismatch entre FSM y classifier por un carácter = bug invisible.
- ❌ **Que el LLM decida qué rama del FSM tomar** → el FSM decide, el LLM solo redacta. Test mecánico: `if` cuya condición depende de texto libre del LLM = bug arquitectónico.
- ❌ **Templates con slots sin ConvContext hidratado** → verificar `ctx.cultivo` y `ctx.segmento` no-null antes de render.
- ❌ **`redactarMensajeSDR(..., 'Devolveme JSON')`** → `redactarMensajeSDR` es `responseFormat:'text'`. Para JSON, usar `clasificarIntencionSDR`. Antipattern guard #1 lo detecta.
- ❌ **Prometer features en prompts que el sistema no puede cumplir** ("PDF con casos de éxito" no existe — antipattern guard #6).

---

## 12. Cómo arrancar una sesión nueva (checklist para agentes IA)

```
□ Leer este archivo (AGENT-CONTEXT) completo
□ Leer AGENTS.md (reglas GGA pre-commit)
□ Leer CLAUDE.md Capa 3 (decisiones D1-D22 activas)
□ mem_search del topic relevante a la tarea
□ Si tarea toca SDR/context: leer ADR-009 completo (no skim)
□ Identificar la fase del refactor (A-E) si aplica
□ Verificar paths con [EXISTE HOY] vs [FASE X — pendiente]
□ Reproduce before fix si hay bug
□ mem_save al final con lo no-obvio aprendido
```
