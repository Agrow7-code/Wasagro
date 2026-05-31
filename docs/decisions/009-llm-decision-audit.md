# 009 — LLM Decision Audit (Fase 0 del refactor SDR)

**Fecha:** 2026-05-31
**Estado:** Aceptada — input para el refactor de fases C→A→B→D→E
**Autores:** Henry Morales + Claude Code
**Revisión externa:** patrones inspirados/validados por [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (Engram, skill-registry, harness)

---

## Contexto

Tras los bugs de SDR (pitch en aire, "Enviame un PDF" → "no te entendí", repetición de pitch tras "Ya?"), se identificó que **el problema no es de prompt sino de arquitectura**: el LLM toma decisiones de flujo en silencio. Antes de refactorear, este ADR audita TODOS los puntos del repo donde un output de LLM influye en un branch posterior, y define el contrato arquitectónico que el refactor debe cumplir.

## Principio operativo

> **El LLM nunca toma decisiones de flujo. Solo produce texto dado un contexto y una rama ya decididos por código.**

Corolario verificable: cualquier `if` cuya condición dependa de texto/JSON emitido por el LLM **es un bug arquitectónico**, no un bug de prompt.

## Las tres capas

| Capa | Responsabilidad | Implementación |
|---|---|---|
| **L1 Decisión** | ¿Qué acción tomar? | FSM puro en TypeScript, testeable, sin LLM |
| **L2 Clasificación** | ¿Qué dijo el usuario? | LLM `responseFormat:'json_object'`, `temp:0`, output Zod enum tipado |
| **L3 Redacción** | ¿Cómo se dice? | LLM `responseFormat:'text'`, `temp:0.3-0.5`, Brief estructurado de entrada |

**Variante E (Extracción):** LLM con `json_object` que estructura datos (no clasifica) para persistencia. Es L2 con esquema más rico.

---

## Contrato de `ConversationContext` (debe quedar firme antes de implementar)

Patrón inspirado en Engram (Gentle-AI), adaptado: **estado destilado tipado** en lugar de historial crudo, porque Wasagro toma decisiones de flujo basadas en él (Engram solo hace recall). Es el contrato que las Fases A-D usan como fuente de verdad.

```ts
// src/agents/sdr/context.ts

import { z } from 'zod'

export const CultivoEnum = z.enum(['cacao', 'banano', 'cafe', 'aguacate', 'piña', 'palma', 'otro'])
export const SegmentoEnum = z.enum(['exportadora', 'cooperativa', 'agricultor', 'ong', 'desconocido'])
export const SDRStateEnum = z.enum([
  'triage', 'discovery', 'pitch_sent', 'objection_handling',
  'closing', 'brochure_sent', 'meeting_proposed', 'meeting_confirmed',
  'declined', 'dormant',
])
export const BotActionEnum = z.enum([
  'ask_question', 'sent_pitch', 'sent_brochure', 'sent_calendar_link',
  'sent_meeting_confirmation', 'sent_graceful_exit', 'none',
])
export const IntentEnum = z.enum([
  'agenda', 'wants_brochure', 'precio', 'objection_time', 'objection_trust',
  'interest', 'advance', 'rechazo', 'consulta', 'neutro', 'other',
])

export const ConvContextSchema = z.object({
  // ── Identidad persistente (Supabase: sdr_prospectos) ───────────────────
  prospectId: z.string(),
  phone: z.string(),

  // ── Datos del prospecto (Supabase, hidratados por classifier + reducer)
  cultivo: CultivoEnum.nullable(),
  pais: z.string().nullable(),
  fincasEstimadas: z.number().nullable(),
  segmento: SegmentoEnum,
  sistemaActual: z.string().nullable(),

  // ── Estado de la conversación (Redis o sesiones_activas) ───────────────
  fsmState: SDRStateEnum,
  lastBotAction: BotActionEnum,
  lastBotMessage: z.string().nullable(),  // último texto enviado, para desambiguar respuestas cortas como "Ya?"
  turnCount: z.number().int().nonnegative(),
  intentHistory: z.array(IntentEnum).max(20),   // últimas N intenciones (sliding window)
  lastObjectionType: z.enum(['precio', 'tiempo', 'confianza', 'producto']).nullable(),

  // ── Señales derivadas (no persistidas — se recalculan por reducer puro)
  signalStrength: z.enum(['hot', 'warm', 'cold', 'unknown']),
  datosConocidos: z.number().int().min(0).max(5),
  clarificationTurnsUsed: z.number().int().min(0).max(2),  // P2: max 2 clarificaciones
})

export type ConvContext = z.infer<typeof ConvContextSchema>
```

**Contrato de invariantes** (testeable con vitest, parte del PR de Fase C):
1. `reduceContext(ctx, classification) → newCtx` es **función pura** sin LLM, sin side effects, sin DB calls.
2. Toda mutación de campos del prospecto pasa por `reduceContext`. Grep `prospecto[...] = ` fuera del reducer = bug.
3. `signalStrength` y `datosConocidos` son **derivados** — nunca se setean directo, se recalculan en el reducer.
4. Todos los classifiers (Fase B) reciben `ConvContext` completo como input, no solo el último mensaje.
5. Todos los templates (Fase A) reciben `ConvContext` como input, hidratan slots con `ctx.cultivo`/`ctx.segmento`/etc.

**Ciclo de vida del context** por turno:
```
1. msg llega → loadContext(prospectId) → ConvContext desde Supabase + Redis
2. classifier(msg, ctx) → IntentClassification tipada
3. reduceContext(ctx, intent) → newCtx (función pura)
4. fsm.next(newCtx) → { action, brief }   // L1: pura lógica TypeScript
5. composer.render(action, brief, newCtx) → mensaje (template + LLM body si aplica)
6. validators.pipe(mensaje, ctx) → mensaje corregido + telemetría
7. saveContext(newCtx) + sender.enviar(mensaje)
```

---

## Tabla de hallazgos

Leyenda de **categoría actual**:
- `DEC` = decisión de flujo (rama del FSM depende del output)
- `EXT` = extracción de datos (output se persiste a DB)
- `RED` = redacción pura (output se envía al usuario)
- `MIX` = mezcla de varios (anti-pattern)

Leyenda de **riesgo**:
- 🔴 CRÍTICO = si el LLM falla, el flow toma rama equivocada silenciosamente
- 🟠 ALTO = dato incorrecto se persiste, flow continúa con basura
- 🟡 MEDIO = UX degradada, recuperable en siguiente turno
- 🟢 BAJO = solo afecta texto enviado, sin efecto en estado

Leyenda de **fase de fix**:
- `A` = mover a template determinístico (`composer.ts`)
- `B` = mover a clasificador tipado (`classifier.ts` con Zod enum)
- `C` = mover a Context Manager (reducer puro)
- `D` = wrap en validator + auto-fix
- `E` = solo achicar prompt
- `OK` = ya cumple el principio operativo

| # | Archivo:Línea | Llamada | Categoría actual | Output usado para | Riesgo | Fix |
|---|---|---|---|---|---|---|
| 1 | `webhook/router.ts:45` | `adapter.verificarWebhook(c)` | DEC | `if (!esValido) return 403` | 🟢 | `OK` — bearer-token check determinístico ya |
| 2 | `procesarMensajeEntrante.ts:82` | (delega a `handleMeetingConfirmation`) | DEC | rutea entre SDR / meeting / event | 🟢 | `OK` — branching por estado DB (`usuario`, `status`) sin LLM |
| 3 | `IntentDetector.ts:53` | `adapter.generarTexto({json_object, temp:0})` | DEC + EXT (mixto) | `result.tipo` → setea `tipo_forzado` en pipeline event | 🟠 | `B` — ya está tipado con Zod enum (✓) pero falla cae a `FALLBACK={tipo:'nuevo_evento', confianza:0}` sin telemetría; agregar logging por categoría |
| 4 | `IntentGate.ts:71` | `adapter.generarTexto({json_object, temp:0})` | DEC + EXT | `tipos_evento[]` define cuántos jobs pg-boss encolar | 🔴 | `B` — tipar más estrictamente; si LLM responde mal se encolan 0 jobs sin alerta |
| 5 | `IntentGate.ts:84` | `JSON.parse(texto)` con `try{}catch{}` que tira | DEC | tipos extraídos definen jobs | 🟠 | `D` — validation layer con telemetría; hoy si falla el parse lanza `LLMError` que rebota arriba |
| 6 | `pgBoss.ts:64` (worker) | `llm.extraerEventos(entrada, traceId)` | EXT | `multiExtraction.eventos[0]` → si `tipo_evento === 'sin_evento'` aborta; sino persiste a DB | 🟠 | `B` (esquema más estricto) + reglas deterministas (línea 75-101 ya extraen lógica del LLM correctamente — patrón a replicar) |
| 7 | `sdrAgent.ts:265` | `llm.clasificarIntencionSDR(texto, opciones[], ctx, traceId)` | DEC | `intencion ∈ {wants_brochure, booked, will_book_later, declined, other}` → switch que decide acción y status | 🔴 | `B` ✓ ya parcial (validado contra opciones, falla → 'other'). **Falta:** ConvContext (C) para que el classifier vea historial, no solo último mensaje |
| 8 | `sdr/router.ts:94` | `llm.extraerDatosSDR(textoOriginal, contextoActual, traceId)` | EXT + C | hidrata `combinedProspecto.{fincas, cultivo, pais, sistema_actual}` → cuenta `datosConocidos` que decide transición discovery → pitch | 🟠 | `B` (esquema OK) + `C` (mover update al ConvContext reducer puro, no inline a `updateData`) |
| 9 | `sdr/router.ts:153` | `llm.clasificarIntencionSDR(opciones, 'objection|advance|other', ctx, traceId)` | DEC | si `'advance'|'other'` → transición a close; si `'objection'` → queda pitch | 🔴 | `B` ✓ ya parcial. **Falta:** que el classifier reciba historial completo, no solo último msg |
| 10 | `sdr/router.ts:198` | `llm.redactarMensajeSDR(textoOriginal, ctx, directiva, traceId)` | RED + DEC implícito | `respuesta` se envía tal cual; estructura del mensaje depende del LLM | 🟡 | `A` (templates para close/brochure) + `E` (achicar prompt) + `D` (validators de estructura) |
| 11 | `procesarExcel.ts:115` | `llm.clasificarExcel(entradaExcel, traceId)` | EXT | `clasificacion.tipo` → switch en handler decide rama (filas a DB / pedir más datos / rechazar) | 🟠 | `B` — tipar resultado con Zod (asumo ya pero hay que confirmar) |
| 12 | `reporteSemanal.ts:121` | `llm.resumirSemana(entrada, traceId)` | RED | texto del resumen se envía vía WhatsApp | 🟢 | `OK` o `E` — solo redacción, no decisión |
| 13 | `WasagroAIAgent.ts:419` | `atenderProspecto` interno | MIX | hoy ya no se usa (reemplazado por FSM `sdr/router.ts`) | — | `OK` — candidato a borrar dead code |
| 14 | `WasagroAIAgent.ts:452` | `onboardarAdmin` interno | MIX | `siguiente_paso`, `paso_completado`, `entidades_extraidas` decide rama del OnboardingHandler | 🟠 | `B` (esquema Zod estricto) + `C` (ConvContext para onboarding también) |
| 15 | `WasagroAIAgent.ts:485` | `onboardarAgricultor` interno | MIX | igual que admin | 🟠 | mismo que #14 |
| 16 | `WasagroAIAgent.ts:213` | `describirImagenVisual` (V2VK) | EXT (descripción) | feed al siguiente paso `diagnosticarSintomaV2VK` | 🟡 | `OK` (es chained extraction, no decision branch) |
| 17 | `WasagroAIAgent.ts:269` | `diagnosticarSintomaV2VK` | EXT | resultado se persiste con `confidence_score`, NO decide branch | 🟢 | `OK` |
| 18 | `WasagroAIAgent.ts:308` | `clasificarTipoImagen` | DEC | `tipo_imagen ∈ {plaga_cultivo, documento_tabla, otro}` → router decide V2VK / OCR / descartar | 🔴 | `B` — verificar Zod enum y telemetría de cada clase predicha |
| 19 | `WasagroAIAgent.ts:358` (loop) | `extraerDocumentoOCR` con auto-retry Zod | EXT | output OCR se persiste; loop deterministic ya cubre fallas | 🟢 | `OK` — buen patrón a replicar (Zod retry loop) |
| 20 | `WasagroAIAgent.ts:553` | `resumirSemana` interno | RED | texto a usuario | 🟢 | `OK` |
| 21 | `WasagroAIAgent.ts:586` | `extraerDatosSDR` interno (impl) | EXT | usado en sdr/router.ts:94 | — | ver #8 |
| 22 | `WasagroAIAgent.ts:633` | `redactarMensajeSDR` interno (impl) | RED | usado en sdr/router.ts:198 | — | ver #10 |
| 23 | `WasagroAIAgent.ts:674` | `clasificarIntencionSDR` interno (impl) | DEC | usado en sdrAgent:265 y router:153 | — | ver #7, #9 |
| 24 | `WasagroAIAgent.ts:720` | `clasificarExcel` interno | EXT | usado en procesarExcel:115 | — | ver #11 |
| 25 | `WasagroAIAgent.ts:759` | `clasificarIntenciones` (pipeline event) | DEC | usado por IntentGate | — | ver #4, #5 |
| 26 | `WasagroAIAgent.ts:830` | `extraerEventos` interno | EXT | usado en pgBoss worker | — | ver #6 |

---

## Hallazgos críticos (🔴)

### H1 — IntentGate y clasificadores no tienen ConversationContext
Tres clasificadores críticos (#4 IntentGate, #7 SDR meeting confirmation, #9 SDR objection) reciben **solo el último mensaje del usuario**, no el historial. Eso explica por qué "Ya?" se clasifica mal: sin saber qué dijo el bot en el turno anterior, "Ya?" es ambiguo de verdad.

**Fix obligatorio:** Fase C — `ConversationContext` con `intentHistory` + `lastBotMessage` pasado a todos los classifiers.

### H2 — Tres llamadas que rutean por output de LLM no tienen telemetría de error
`IntentDetector.detectar` (#3) hace `return FALLBACK` silencioso. `IntentGate` (#5) lanza `LLMError` que se atrapa más arriba. `clasificarTipoImagen` (#18) no he confirmado el path de error. **Sin telemetría, una degradación del classifier (model swap, prompt drift) se descubre por queja de cliente, no por dashboard.**

**Fix obligatorio:** Fase D — cada classifier emite evento Langfuse con `{predicted, confidence, fallback_used}` independiente del trace general.

### H3 — `redactarMensajeSDR` aún se usa para mensajes estructurales
Aunque ya migramos las 2 classifications a método tipado, el close y el pitch siguen pasando por `redactarMensajeSDR` (#10). El bug del pitch-en-aire es resultado directo: el LLM decide la estructura del mensaje crítico.

**Fix obligatorio:** Fase A — templates en `composer.ts` para `close_offer`, `brochure_send`, `meeting_confirmation`, `graceful_exit`. El pitch body sí queda LLM pero con Brief estructurado y CTA appended por código.

---

## Orden de fases: **C → A → B → D → E** (corregido)

El orden original A→B→C→D→E **es incorrecto**. Razón: si migramos los 5 callsites a templates (A) pero `ConvContext` aún no existe (C), los slots se hidratan con datos vacíos o incorrectos. `TEMPLATES.closeOffer(ctx)` necesita `ctx.cultivo` y `ctx.segmento` confiables — sin reducer puro, esos campos vienen del `prospecto` actual con mutaciones inline y bugs latentes (e.g. cultivo se sobrescribe en el segundo turno si el classifier extrae mal).

El orden correcto es:

| # | Fase | Por qué este orden |
|---|---|---|
| 1 | **C** Reducer + ConvContext | Fuente de verdad que todo el resto consume. Sin esto, A y B se construyen sobre arena. |
| 2 | **A** Templates en skills/templates/ | Slots ahora tienen datos confiables de ConvContext. |
| 3 | **B** Classifier unificado con Zod | Recibe ConvContext ya hidratado (resuelve H1 "Ya?" mal clasificado). |
| 4 | **D** Validators + auto-fix + observabilidad | Hay algo confiable que monitorear. Métricas distinguen "bug del usuario" de "drift del modelo". |
| 5 | **E** Achicar prompts | Solo cuando capas anteriores garantizan lo que el prompt intentaba garantizar con texto. |

---

## Mapa fase-a-archivo (output del audit → input al refactor)

### Fase C — ConvContext + reducer puro
```
NUEVO  src/agents/sdr/context.ts       — ConvContext schema + reduceContext()
NUEVO  src/agents/sdr/intents.ts       — IntentEnum compartido (única source of truth)
NUEVO  tests/agents/sdr/context.test.ts — ≥20 casos cubriendo updates de cada campo
EDIT   src/agents/sdr/router.ts:104-115 — updateData inline → reduceContext(ctx, intent)
EDIT   src/pipeline/supabaseQueries.ts — loadContext(prospectId), saveContext(ctx) helpers
EDIT   src/integrations/redis.ts        — cache de session-scoped fields (lastBotMessage, etc.)
```

### Fase A — Templates como skill registry (patrón Gentle-AI)
**No hardcodear templates en `composer.ts`.** Cargar dinámicamente según estado/intent, igual que `gentle-ai skill-registry`:

```
src/agents/sdr/skills/
├── templates/
│   ├── close-offer.ts         → fsmState='closing'
│   ├── brochure-send.ts       → action='sent_brochure'
│   ├── calendar-link.ts       → action='sent_calendar_link'
│   ├── meeting-confirm.ts     → action='sent_meeting_confirmation'
│   ├── graceful-exit.ts       → action='sent_graceful_exit'
│   └── will-book-later.ts     → intent='will_book_later'
├── objections/                — inyectado cuando intent ∈ {precio, tiempo, ...}
│   ├── precio.ts
│   ├── tiempo.ts
│   └── confianza.ts
└── registry.ts                — index { fsmState → template, action → template }
```

Cada template exporta `render(ctx: ConvContext): string`. El composer resuelve por estado, no por if-else gigante. Agregar template nuevo = nuevo archivo + entry en registry. **Cero edit al composer.**

Callsites migrados:
- `sdr/router.ts:198` close directive → `composer.resolve(ctx).render()`
- `sdr/router.ts:227` followUp link → `templates/calendar-link.ts`
- `sdrAgent.ts:284` wants_brochure → `templates/brochure-send.ts`
- `sdrAgent.ts:296` declined → `templates/graceful-exit.ts`
- `sdrAgent.ts:301` will_book_later → `templates/will-book-later.ts`

### Fase B — Classifier unificado (Gentle-AI retry-with-feedback pattern)
```
NUEVO  src/agents/sdr/classifier.ts    — clasificarIntent(msg, ctx, traceId): {intent, confidence, raw}
USE    src/agents/sdr/intents.ts       — enum único compartido con FSM (cero strings duplicados)
EDIT   src/agents/sdr/router.ts:153    — usar classifier con ctx (resuelve H1)
EDIT   src/agents/sdrAgent.ts:265      — usar classifier con ctx (resuelve H1)
EDIT   src/integrations/llm/IntentGate.ts → migrar al classifier interface
EDIT   src/agents/orchestrator/IntentDetector.ts → migrar (mantener su Zod actual)
EDIT   src/pipeline/procesarExcel.ts:115 → wrap en classifier
EDIT   src/integrations/llm/WasagroAIAgent.clasificarTipoImagen → wrap

Retry pattern (de OCR loop + Gentle-AI SDD review):
1. classifier llama LLM con json_object
2. Zod parse → si falla, retry UNO con prompt que incluye qué campo falló y formato esperado
3. Si segundo retry falla → fallback con telemetría 'classifier_fallback_used'
4. Nunca catch silencioso. Cada fallback emite evento Langfuse.
```

### Fase D — Validators con observabilidad real (no solo logging)
```
NUEVO  src/agents/sdr/validators.ts
NUEVO  src/agents/sdr/metrics.ts       — wrapper Langfuse para métricas de validators

Pipeline:
const validated = validators.pipe(rawText, ctx)
  .check('endsWithQuestion',   { autoFix: smartReplaceOrAppendCTA(ctx) })
  .check('noProhibitedTerms',  { autoFix: redactTerms })
  .check('maxSentences',       { autoFix: truncateAtSentence(N) })
  .check('mentionsBotCanDeliver', { autoFix: removePromiseSentence })  // ej: "PDF con casos de éxito"
  .result()

Smart auto-fix (no append a ciegas):
- endsWithQuestion: si última oración es DECLARATIVA → replace_last_sentence con CTA del pool
                    si es ABIERTA → append CTA
                    si ya es pregunta → no-op

Métricas como observabilidad (no como log):
- Cada validator emite Langfuse event con {validator, activated, autofix_type, ctx_state}
- Dashboard agrega frecuencia por validator y estado
- Alert thresholds:
    endsWithQuestion.rate > 10% → directiva del LLM rota
    classifierFallback.rate > 5% → vocabulario drift, prompt o modelo
    mentionsBotCanDeliver.rate > 1% → prompt todavía promete features inexistentes
```

### Fase E — Achicar prompts (último, cuando las capas anteriores garantizan)
```
EDIT  sdr/prompts/SP-SDR-03-writer.md  — de 5 reglas a 3 (tono, brevedad, no-redundancia)
                                          Revertir "Regla 5" (la pasamos a validator Fase D)
KEEP  sdr/prompts/SP-SDR-02-extractor.md — ya está corto, OK
AUDIT prompts/sp-00-prospecto.md       — confirmar si está vivo o es dead code (mismo grep que #13)
```

---

## Métricas de éxito por fase

| Fase | Métrica de éxito medible |
|---|---|
| C | `reduceContext()` testeado con ≥20 casos (cobertura por cada campo de ConvContext). Grep `prospecto\[.*?\]\s*=` fuera de `context.ts` y reducer = 0 matches. Todos los classifiers reciben `ConvContext` (no `string` solo). |
| A | 100% de closes, brochure sends, gracefulExit, bookLater y meeting confirmations pasan por template. Grep `redactarMensajeSDR` en SDR pipeline = solo para pitch body. Templates registrados en `registry.ts` con 1 entry por estado/action. |
| B | Todas las llamadas de classification pasan por `classifier.ts`. Grep `redactarMensajeSDR.*JSON` = 0 hits. `IntentEnum` único en `intents.ts`, importado por FSM y classifier (cero strings hardcoded). Retry-with-feedback implementado, telemetría per attempt. |
| D | Dashboard Langfuse con freq por validator. En staging ninguno supera 10% en ventana 24h. Alertas configuradas para `classifierFallback > 5%` y `mentionsBotCanDeliver > 1%`. |
| E | Token count de SP-SDR-03 < 200. Regla 5 movida a validator. Dead-code de prompts confirmado y removido. |

---

## Riesgo del refactor

- **Riesgo medio:** los handlers de onboarding (`OnboardingHandler.ts`) también van a tener que migrar a ConvContext + classifier tipado. Eso multiplica el scope si lo hacemos al mismo tiempo. **Mitigación:** Fases A-E aplican SOLO al pipeline SDR primero. Onboarding queda en backlog (fase F) hasta validar la arquitectura.
- **Riesgo bajo:** `clasificarTipoImagen` (#18) está en hot path del pipeline de fotos. Su tipado mejora confiabilidad pero requiere test con imágenes reales antes de mergear.

---

## Consecuencias

- Cada futuro bug en SDR/onboarding tiene un grep mecánico de diagnóstico: "¿el output del LLM se usa en un `if`?" Si sí, falta migrar a classifier tipado.
- Nuevos features SDR ya no se implementan agregando reglas al prompt — se agregan templates o nuevos cases al classifier enum.
- Onboarding queda con deuda técnica explícita (puntos #14 y #15) para fase F.
- Hay 1 candidato a borrado (`atenderProspecto` #13) si confirmamos que no se invoca desde ningún lado vivo.

---

## Anexo A: lo que NO está en este audit

- Lógica de pricing (`calcularPrecio` en sdrAgent y router) — duplicación de código pre-existente, no decisión LLM.
- Reglas de plaga determinística (`pgBoss.ts:75-101`) — **ya están bien**, son el patrón a replicar en otros lados.
- Loop de auto-corrección Zod en OCR (`WasagroAIAgent.ts:358`) — **buen patrón existente**, no requiere cambios (solo lo extendemos en Fase B con retry-with-feedback explícito).

---

## Anexo B: validación contra el patrón Gentle-AI

Después de la revisión externa con el repo [Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai), tres patrones de su arquitectura validan o refinan las decisiones de este ADR:

| Patrón Gentle-AI | Aplicación a Wasagro |
|---|---|
| **Engram** — memoria persistente con `mem_save`, `mem_search`, `topic_keys` para upsert | Inspira `ConvContext` (Fase C). Diferencia importante: Engram es texto libre porque solo hace recall; **Wasagro toma decisiones de flujo basadas en memoria, por eso ConvContext es typed con Zod enums**, no blob de texto. |
| **Skill Registry** — `.atl/skill-registry.md` indexa skills, matching por descripción completa, dynamic loading | Inspira `src/agents/sdr/skills/templates/` (Fase A). Cada template = archivo separado, `registry.ts` mappea estado→template. Agregar nuevo template no requiere edit del composer (extensibilidad sin churn). |
| **SDD retry-with-feedback** — review phase devuelve qué campo falló para que la regeneración sea quirúrgica | Inspira el retry del classifier (Fase B). En lugar de retry ciego con el mismo prompt, el segundo intento recibe "el campo X falló con razón Y, regenerá solo eso". Baja retries de 3 a 1 y mejora hit-rate del JSON válido. |

**Anti-pattern que Gentle-AI confirma a evitar:** mezclar decisión + clasificación + redacción en una sola llamada LLM. El harness de Gentle-AI usa **per-phase model routing** (modelos distintos para design/implementation/exploration/review) — la separación de capas no es solo arquitectónica, también de modelo. Wasagro hoy usa `modelClass: 'fast'` para todo SDR — eso queda como nota para fase G futura: usar `'fast'` para classification (temp 0) y `'reasoning'` para redacción cuando el contexto lo amerite.

---

## Anexo C: anti-pattern guards (grep-checks para CI)

Cuando el refactor termine, estos greps deben devolver 0 matches. Cualquiera con >0 = regresión:

```bash
# 1. Decisión basada en texto libre del LLM
rg 'JSON\.parse\(.+(redactar|generar)' src/

# 2. Strings de intent hardcoded fuera del enum único
rg "'(wants_brochure|booked|will_book_later|declined|advance|objection)'" src/ --type ts | rg -v 'src/agents/sdr/intents.ts'

# 3. Mutación directa de prospecto fuera del reducer
rg 'prospecto\[.+\]\s*=' src/ | rg -v 'src/agents/sdr/context.ts'

# 4. Classifier sin ConvContext
rg 'clasificarIntencionSDR\(' src/ | rg -v 'ConvContext'

# 5. Templates hardcoded en composer
rg 'TEMPLATES\s*=\s*\{' src/agents/sdr/

# 6. Promesas falsas en prompts
rg -i 'casos de éxito|case studies|caso de exito' prompts/ sdr/prompts/
```

Estos checks pueden ir como pre-commit hook en una fase posterior, garantizando que el principio operativo del ADR no se erosione con el tiempo.
