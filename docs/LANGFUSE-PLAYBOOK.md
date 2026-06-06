# LangFuse Playbook — Wasagro

> Cómo sacarle el máximo provecho a LangFuse Cloud / self-hosted para Wasagro.
> Este doc es operativo: explica qué configurar en la **UI de LangFuse** y
> cómo leer la data que el código ya emite.

---

## 1. Setup inicial (una sola vez)

### 1.1 Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `LANGFUSE_SECRET_KEY` | Sí | SDK auth |
| `LANGFUSE_PUBLIC_KEY` | Sí | SDK auth |
| `LANGFUSE_HOST` | No (default cloud.langfuse.com) | Self-hosted URL |

Sin las 2 keys, todo el código de instrumentación es **no-op** transparente.
El `PromptManager` automáticamente cae a leer del disco. No hay falla.

### 1.2 Subir los prompts del disco a Langfuse Prompts (la sección que estaba vacía)

```bash
# Preview sin escribir
npm run prompts:sync -- --dry-run

# Push todos los 27 prompts con label 'production'
npm run prompts:sync

# Push a un label diferente para experimentación A/B
npm run prompts:sync -- --label staging

# Subir solo un subset (glob simple)
npm run prompts:sync -- --only sp-sdr-*
```

Después del primer sync:
- La sección **Prompts** en la UI muestra los 27 prompts versionados.
- Editar un prompt en la UI + setear label `production` → propagación
  automática al runtime (cache TTL 5 min).
- Cada generación en el dashboard linkea a la versión exacta del prompt que
  se usó (cuando se pasa `promptClient` en `runTypedClassifier`).

---

## 2. Anatomía de los traces

Cada inbound message abre una trace **root** con name + tags + metadata.
Pipelines downstream **extienden** la misma trace con sus propios tags
(`langfuse.trace({id, ...})` hace upsert).

### 2.1 Trace roots y sus tags

| Root trace name | Tags | Cuándo se crea |
|---|---|---|
| `inbound_message` | `inbound`, `<tipo>` (`texto`/`audio`/`imagen`) | Cada webhook entrante |
| `calcom_webhook` | `webhook`, `calcom` | Webhook de Cal.com booking |
| `alertas_clima` | `cron`, `alertas`, `clima` | Cron diario clima |
| `alertas_precio` | `cron`, `alertas`, `precio` | Cron semanal precio banano |
| `reporte_semanal` | `cron`, `reporte`, `semanal` | Cron semanal reporte |

### 2.2 Pipelines downstream (extienden la trace root)

| Pipeline name | Tags adicionales | Metadata |
|---|---|---|
| `sdr_pipeline` | `sdr`, `<tipo>` | `phone`, `wamid` |
| `onboarding_pipeline` (admin) | `onboarding`, `admin` | `usuario_id`, `phone`, `finca_id`, `rol` |
| `onboarding_pipeline` (agricultor) | `onboarding`, `agricultor` | idem |
| `event_pipeline` | `event`, `<tipo>`, `<rol>` | `usuario_id`, `phone`, `finca_id`, `org_id` |

### 2.3 Cómo filtrar en la UI

| Pregunta | Filter |
|---|---|
| Todos los SDR de hoy | `tags has any: sdr` + time range |
| Solo audios de SDR | `tags has all: sdr, audio` |
| Onboardings que llegaron a completar | `tags has all: onboarding` + custom score >= 1 |
| Alertas que fallaron | `tags has all: cron` + level=ERROR en cualquier event |

---

## 3. Anatomía de los generations (el dashboard que faltaba)

Cada LLM call emite **DOS** generations:

1. **Outer (semantic wrapper)**: `model='wasagro/orchestrator'`,
   `name='<operacion-semantica>'` (`sdr_intent_classifier`,
   `onboardar_admin`, `v2vk_diagnose`, etc.). Esta NO es una LLM call —
   es el wrapper que orquesta retry-with-feedback y telemetría.
2. **Inner (real LLM call)**: `model=<modelo-real>` (e.g.,
   `llama-3.3-70b-versatile`, `gemini-2.5-flash`, `kimi-k2.6`),
   `name='<classifierName>_attempt_1'` o `_attempt_2_retry`. Esta sí es
   una LLM call con costo + latencia reales.

### 3.1 Filtros útiles en el dashboard de Generations

| Pregunta | Filter |
|---|---|
| Solo LLM calls reales (no wrappers) | `model NOT LIKE 'wasagro/%'` |
| Costo por modelo | group by `model`, sum `cost` |
| Latencia P95 por modelo | group by `model`, p95 `latency` |
| Retry rate por classifier | filter `name CONTAINS '_attempt_2_retry'`, count vs `_attempt_1` |
| Cost por pipeline | join trace.tags → group |
| Fast vs reasoning vs ultra | filter `metadata.modelClass = 'fast'` etc. |

### 3.2 Generations clave (lista completa)

| Generation name | Pipeline | Qué hace |
|---|---|---|
| `sdr_intent_classifier` | sdr | Classifier tipado Fase B |
| `sdr_classifier_attempt_1`/`_2_retry` | sdr | Inner — el LLM call real |
| `intent_gate` | event | IntentGate clasifica intenciones de evento |
| `event_intent_detector` | event | IntentDetector orchestrator |
| `event_classify` | event | Clasifica tipo_evento (insumo/labor/plaga/etc.) |
| `extraer_sdr` | sdr | Extracción de datos SDR (LLM Fase B) |
| `redactar_sdr` | sdr | Redacción del mensaje SDR (LLM Fase B) |
| `clasificar_intencion_sdr` | sdr | Clasificador intent en handleMeetingConfirmation |
| `onboardar_admin` | onboarding | Onboarding LLM admin |
| `onboardar_agricultor` | onboarding | Onboarding LLM agricultor |
| `clasificar_imagen` | event | Tipo de imagen (plaga/documento/otro) |
| `vision_describe_attempt_${N}` | event | V2VK descripción de imagen |
| `v2vk_diagnose` | event | V2VK diagnóstico con RAG |
| `ocr_documento_attempt_${N}` | event | OCR con auto-retry Zod |
| `clasificar_excel` | event | Clasificación Excel |
| `stt_post_correction` | event | Post-corrección STT (Deepgram → glosario) |
| `resumir_semana` / `resumen_semanal` | cron | Resumen semanal por finca |

---

## 4. Eventos críticos (events que disparan alertas)

| Event name | Level | Significa | Acción |
|---|---|---|---|
| `sdr_classifier_fallback_used` | WARNING | Classifier exhausted retries — fallback `other` | Si > 5% en 24h: SP-SDR-03 drift, fix prompt |
| `<classifier>_fallback_used` | WARNING | Idem para IntentDetector, IntentGate, clasificarExcel, clasificarImagen, onboardarAdmin, onboardarAgricultor | Idem |
| `sdr_validator_fired` | DEFAULT | Validator de Fase D (endsWithQuestion / noUnnecessaryApology / noFalsePromises) corrigió el output del LLM | Si `endsWithQuestion.rate > 10%`: SP-SDR-03 prompt está roto. Si `noFalsePromises.rate > 1%`: el LLM promete features inexistentes |
| `sdr_classifier_low_confidence_downgrade` | DEFAULT | LLM devolvió confidence < 0.7, se downgrade a `other` | Materia prima del eval dataset; revisar cada caso manualmente para decidir si subir threshold |
| `sdr_brochure_dedup_skipped` | WARNING | Brochure dedup (TODO 1) bloqueó un duplicado | Si dispara > 0/día en steady state, hay un bug upstream — investigar |
| `sdr_out_of_scope_cultivo` | WARNING | Prospect con cultivo NO MVP detectado | Este es el WAITLIST manual. Exportar el event log con `phone + cultivo + timestamp` |
| `onboarding_admin_max_steps` / `_agricultor_` | WARNING | Onboarding llegó a 10 turnos sin completar | Revisar el flow conversacional — prompt está roto o pidiendo demasiado |
| `sdr_audio_received` | DEFAULT | Audio inbound (FIX-3) — interés alto del prospecto | Tracking de conversión audio→close |
| `sdr_extraction_zod_failure` | WARNING | Extracción SDR falló schema | Si > 2% sostenido: el extractor está drift |
| `webhook_idempotency_hit` | DEFAULT | Evolution API redelivery — dedup funcionando | Si > 90% son duplicados, revisar Evolution config |

---

## 5. Alertas recomendadas (configurar en UI > Settings > Alerts)

### Tier 1 — bloqueantes (warrant pager)

| Alerta | Trigger | Severidad |
|---|---|---|
| **SDR classifier exhausted retries** | `sdr_classifier_fallback_used` rate > 5% en 24h | Critical |
| **Cualquier `*_fallback_used` event ratio** | suma de `*_fallback_used` / total inbound > 5% en 24h | Critical |
| **Validators saturated (prompt roto)** | `endsWithQuestion.rate > 10%` O `noFalsePromises.rate > 1%` en 24h | Warning |
| **OCR auto-retry exhausted** | `ocr_zod_exhausted` rate > 2% en 24h | Warning |

### Tier 2 — observabilidad (revisión semanal)

| Alerta | Trigger | Severidad |
|---|---|---|
| Out-of-scope cultivo log diario | `sdr_out_of_scope_cultivo` count diario > 0 | Info — exportar para waitlist |
| Onboardings que llegan al max steps | `onboarding_*_max_steps` count > 5/día | Warning |
| Latencia P95 del classifier rápido | `sdr_classifier_attempt_1` p95 > 3s | Warning |
| Costo diario por finca activa | `cost_per_finca > $6/finca/mes` (CLAUDE.md CR3) | Warning |

---

## 6. Dashboards recomendados (Dashboards > New)

### 6.1 SDR Funnel Dashboard

Widgets:
1. **Inbound count by tipo** — bar chart, group by trace.tags has `texto`/`audio`/`imagen`
2. **SDR turns to close** — histogram, count turns per prospecto_id where action_taken=close
3. **Fallback rates por classifier** — line chart, `*_fallback_used` events / total inbound
4. **Validators activation rate** — line chart, `sdr_validator_fired.input.validators` desglosado
5. **Out-of-scope cultivos pipeline** — table, `sdr_out_of_scope_cultivo` events con phone+cultivo+timestamp

### 6.2 Cost & Performance Dashboard

Widgets:
1. **Cost por modelo (top 10)** — pie chart, sum cost group by model, exclude `wasagro/%`
2. **Latencia P50/P95/P99 por generation name** — table, group by name
3. **Tokens in/out por pipeline** — bar chart, sum input_tokens+output_tokens group by trace.tags
4. **Costo por finca activa** — derived: total cost / count(distinct trace.metadata.finca_id) en 30d

### 6.3 Event Pipeline Quality Dashboard

Widgets:
1. **mandatory_missing=[] rate** — gauge, target ≥ 40% H0 / 60% H1
2. **Zod failures por clasificador** — bar chart, count events `*_zod_failure`
3. **STT WER proxy** — derived from `stt_post_correction` event count (alta correction rate = WER alto)
4. **OCR auto-retry rate** — `ocr_documento_attempt_${N}` distribution

---

## 7. Workflow operativo recomendado

### Diario (15 min)
1. Revisar **Tier 1 alerts** — si dispararon, fix prompt o codigo.
2. Spot-check 5-10 traces random con `tags has 'sdr'` para confirmar UX.

### Semanal (30 min)
1. Exportar `sdr_out_of_scope_cultivo` events → actualizar waitlist en Notion.
2. Revisar `sdr_validator_fired` patterns — si un validator dispara consistente, decidir si:
   - Fix del prompt (preferido), o
   - Bajar threshold del validator (riesgo, solo si datos lo soportan)
3. Revisar `sdr_classifier_low_confidence_downgrade` muestra — el dataset para tunear el threshold.

### Mensual
1. Calcular cost por finca activa real → compararar contra CR3 target ($0.15/finca/mes).
2. Revisar P95 latencia por pipeline → garantizar P3 (<30s pipeline completo).

---

## 8. Cuándo NO usar el dashboard (limites conocidos)

- **No para debugging de un bug puntual de un prospecto** — usá los logs del backend
  con el `wamid` o `phone`. El dashboard es agregado, no per-trace.
- **No para auditoría legal de consent** — usá la tabla `user_consents` en Supabase.
  Langfuse no es source of truth de compliance.
- **No para business analytics fuera del producto** — esos viven en Notion + Supabase
  views. Langfuse es **observabilidad del LLM**, no del negocio.

---

## 9. Mantenimiento

- **Sync de prompts post-edit en UI:** TTL del cache es 5 min. Si tocás label
  production en la UI, la propagación es automática.
- **Schema drift en metadata:** si agregás un campo a trace.metadata, el dashboard
  sigue funcionando — viejas traces simplemente no tienen el campo.
- **Costo de retención de traces:** Langfuse cobra por retention. Para Wasagro a 100
  fincas, 480 eventos/finca/mes = 48k traces/mes. Verificar plan + retention setting.
