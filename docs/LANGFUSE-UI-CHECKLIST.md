# LangFuse UI — Checklist de configuración inicial

> Paso a paso clickeable. Tiempo estimado: **30 min**.
>
> Pre-requisito: `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` disponibles.
> El método más simple: crear un `.env` local (gitignored) con las 3 vars:
>
> ```bash
> cat > .env <<'EOF'
> LANGFUSE_PUBLIC_KEY=pk-lf-xxxx
> LANGFUSE_SECRET_KEY=sk-lf-xxxx
> LANGFUSE_HOST=https://cloud.langfuse.com
> EOF
> ```
>
> Los scripts (`langfuse:status`, `prompts:sync`) auto-cargan `.env` si existe.
> Verificá con `npm run langfuse:status`.

---

## 0. Verificación del setup (2 min)

```bash
npm run langfuse:status
```

Esperado:
- ✓ Env vars OK
- ✓ Connection OK
- ✗ Faltan en Langfuse (27 prompts) ← si nunca corriste sync
- O ✓ Todos los prompts del disco están en Langfuse ← si ya está hecho

---

## 1. Sync de prompts (5 min)

### Si la sección Prompts está vacía

```bash
# Preview primero
npm run prompts:sync -- --dry-run

# Si todo bien, push real con label production
npm run prompts:sync
```

Al terminar, el script imprime el URL directo a la sección Prompts.

### Verificación

1. Abrir Langfuse UI → **Prompts**
2. Esperás ver **27 entries** (`sp-*.md` + `SP-SDR-*.md` + `intent-detector.txt`).
3. Cada uno debe tener `version: 1` y `labels: production`.

### Edición desde la UI

Para tunear un prompt sin redeploy:
1. UI → Prompts → seleccionar prompt
2. Edit → cambiar contenido
3. **Importante**: setear label `production` en la nueva versión (sino el código sigue usando la versión vieja).
4. Propagación al runtime: ≤ 5 min (TTL del cache en `PromptManager`).

---

## 2. Alertas Tier 1 (15 min) — UI > Settings > Alerts

> Las screenshots y nombres exactos pueden variar entre versiones de Langfuse.
> Los **filters** y **conditions** son lo que importa — copy-paste directo.

### Alerta 1.1 — SDR classifier exhausted retries (CRITICAL)

| Campo | Valor |
|---|---|
| Name | `sdr_classifier_fallback_used > 5% / 24h` |
| Type | Threshold-based event ratio |
| Numerator filter | `event.name = "sdr_classifier_fallback_used"` |
| Denominator filter | `trace.tags has "sdr"` |
| Time window | 24h sliding |
| Trigger | ratio > 0.05 (5%) |
| Severity | Critical |
| Channel | Founder pager (Slack #alerts / email) |

**Interpretación cuando dispara:** prompt SP-SDR-03 drifteó O el modelo cambió. Acción: revisar muestra de 10 fallbacks en `sdr_classifier_fallback_used.input.userContentPreview` para ver qué falló.

### Alerta 1.2 — Cualquier `*_fallback_used` agregado (CRITICAL)

| Campo | Valor |
|---|---|
| Name | `total LLM classifier fallbacks > 5% / 24h` |
| Type | Threshold-based event ratio |
| Numerator filter | `event.name LIKE "%_fallback_used"` (regex match) |
| Denominator filter | (none — global rate) |
| Time window | 24h sliding |
| Trigger | ratio > 0.05 |
| Severity | Critical |

**Interpretación:** algún classifier está sobrepasado (SDR, IntentGate, IntentDetector, clasificarExcel, clasificarTipoImagen, onboardarAdmin, onboardarAgricultor). El playbook `LANGFUSE-PLAYBOOK.md §4` tiene la lista exacta.

### Alerta 1.3 — endsWithQuestion rate (WARNING)

| Campo | Valor |
|---|---|
| Name | `endsWithQuestion validator fires > 10% / 24h` |
| Type | Threshold-based event ratio |
| Numerator filter | `event.name = "sdr_validator_fired"` AND `event.input.validators contains "endsWithQuestion"` |
| Denominator filter | `trace.name = "sdr_pipeline"` AND `event.name = "redactar_sdr"` (LLM-redacted turns only) |
| Time window | 24h sliding |
| Trigger | ratio > 0.10 |
| Severity | Warning |

**Interpretación:** el LLM no está cerrando con pregunta consistentemente → SP-SDR-03 necesita refinarse o el modelo cambió de comportamiento.

### Alerta 1.4 — noFalsePromises rate (WARNING)

| Campo | Valor |
|---|---|
| Name | `noFalsePromises validator fires > 1% / 24h` |
| Type | Threshold-based event ratio |
| Numerator filter | `event.name = "sdr_validator_fired"` AND `event.input.validators contains "noFalsePromises"` |
| Denominator filter | `trace.name = "sdr_pipeline"` |
| Time window | 24h sliding |
| Trigger | ratio > 0.01 |
| Severity | Warning |

**Interpretación:** el LLM está prometiendo "casos de éxito" / "testimonios" / "PDF con casos" que no existen → el SP-SDR-03 prompt está siendo demasiado vendedor sin contención.

### Alerta 1.5 — OCR auto-retry exhausted (WARNING)

| Campo | Valor |
|---|---|
| Name | `ocr_zod_exhausted > 2% / 24h` |
| Type | Threshold-based event ratio |
| Numerator filter | `event.name = "ocr_zod_exhausted"` |
| Denominator filter | `trace.name = "event_pipeline"` AND `metadata.has_image = true` |
| Time window | 24h |
| Trigger | ratio > 0.02 |
| Severity | Warning |

**Interpretación:** el OCR no está pasando el schema Zod tras 2 retries — modelo OCR drifteó o las planillas cambiaron formato.

---

## 3. Tres dashboards (12 min) — UI > Dashboards > New

### 3.1 SDR Funnel Dashboard

**Nombre:** `SDR Funnel`
**Trace filter:** `trace.tags has "sdr"`
**Time range:** Last 7 days

| Widget | Tipo | Query/Filter |
|---|---|---|
| Inbound count by tipo | Bar chart | x=trace.created_at (day), y=count, group by `trace.tags` (one of: texto/audio/imagen) |
| SDR turns to close | Histogram | x=count of `event.name = "sdr_template_used"` AND `event.input.templateKey = "closeOffer"` per prospect, group by trace.metadata.prospecto_id |
| Fallback rates por classifier | Line chart | y=count of `event.name LIKE "%_fallback_used"`, group by `event.name`, time bucket=1h |
| Validators activation rate | Stacked bar | x=time bucket(1h), y=count of `event.name = "sdr_validator_fired"`, stack by `event.input.validators[*].name` |
| Out-of-scope cultivos | Table | columns: phone, cultivo, timestamp. Filter: `event.name = "sdr_out_of_scope_cultivo"`. Last 30d |

### 3.2 Cost & Performance Dashboard

**Nombre:** `Cost & Performance`
**Trace filter:** none (global)
**Time range:** Last 30 days

| Widget | Tipo | Query/Filter |
|---|---|---|
| Cost por modelo (top 10) | Pie chart | sum=generation.cost, group by `generation.model` WHERE `model NOT LIKE 'wasagro/%'` (excluir wrappers) |
| Latencia P50/P95/P99 por operation | Table | columns: generation.name, p50_ms, p95_ms, p99_ms. Group by name |
| Tokens in/out por pipeline | Bar chart | x=`trace.tags[0]` (sdr/onboarding/event), y=sum(generation.usage.input_tokens + output_tokens) |
| Costo por finca activa (proxy) | Single value | sum(generation.cost) / count(distinct trace.metadata.finca_id) WHERE last 30d AND `finca_id IS NOT NULL`. Target < $6/mes per CLAUDE.md CR3. |
| Modelo fastClass vs reasoning vs ultra | Pie chart | count, group by `generation.metadata.modelClass` |

### 3.3 Event Pipeline Quality Dashboard

**Nombre:** `Event Pipeline Quality`
**Trace filter:** `trace.name = "event_pipeline"`
**Time range:** Last 7 days

| Widget | Tipo | Query/Filter |
|---|---|---|
| mandatory_missing=[] rate (NSM) | Gauge | count(event.name = "evento_completo") / count(trace) — target ≥ 40% H0, 60% H1, 75% H2 (per CLAUDE.md KPIs) |
| Zod failures por classifier | Bar chart | count of `event.name = "*_zod_failure"` group by event name |
| STT post-correction rate | Line chart | count(generation.name = "stt_post_correction") / count(trace.tags has "audio") — alto = WER alto |
| OCR auto-retry distribution | Histogram | count of generations matching `name LIKE "ocr_documento_attempt_%"`, x=attempt number |
| Time-to-capture P95 | Single value | p95(trace.duration_ms) WHERE `trace.name = "event_pipeline"` — target < 60s H0, < 30s H1 |

---

## 4. Verificación final (3 min)

### Smoke test post-config

1. Mandar un mensaje WhatsApp de prueba al número de prod (que dispare el SDR).
2. Abrir Langfuse → Traces → buscar la trace con `tags has "sdr"`.
3. Confirmar:
   - ✓ Trace tiene `name: "sdr_pipeline"` + tags + metadata.phone
   - ✓ Generations nested con `model="wasagro/orchestrator"` (wrappers) Y `model="<real-model>"` (calls reales del adapter)
   - ✓ Si fue un audio: `event.name = "sdr_audio_received"` presente
   - ✓ Si redactó el LLM: el `generation` linkea al prompt SP-SDR-03 (botón "View prompt version")

### Si algo no aparece

| Síntoma | Causa probable | Fix |
|---|---|---|
| Generations sin link a prompt | sync no corrió | `npm run prompts:sync` |
| Generation.model = "wasagro-ai-agent" (viejo) | deploy con LangFuse 2 (commit 532a10e) pending | redeploy |
| Trace sin name/tags | deploy con LangFuse 2 pending | redeploy |
| Alerts no disparan en data conocida | filter syntax depende de versión de Langfuse | revisar UI docs de la versión instalada |

---

## 5. Mantenimiento periódico

Esta config es one-shot pero requiere mantenimiento ligero:

- **Mensual:** revisar costo por finca activa contra target ($0.15/finca/mes per CR3).
- **Trimestral:** revisar si nuevos generation names aparecieron sin estar en los dashboards. Update.
- **Cuando se agreguen nuevos validators:** sumar widget al SDR Funnel dashboard con el ratio del validator nuevo.

---

## Referencias

- `docs/LANGFUSE-PLAYBOOK.md` — conceptos + lista completa de eventos críticos
- `scripts/sync-prompts-to-langfuse.ts` — código del sync
- `scripts/langfuse-status.ts` — smoke test del setup
- `src/integrations/langfuse.ts` — wiring del SDK
- `src/pipeline/promptManager.ts` — fetch logic con cache
