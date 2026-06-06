# 011 — Instrumentación de costos de servir por organización

**Fecha:** 2026-06-06
**Estado:** Aceptada
**Decisiones relacionadas:** D27 (CLAUDE.md), D26 (billing)

## Contexto

No se sabe cuánto cuesta servir cada cliente. `wa_message_costs` existe en DB pero CERO código TypeScript escribe en ella. Los adapters LLM hardcodean `totalTokens: 0`. Sin costos reales, no se puede calcular margen por cliente ni optimizar pricing de D26.

## Decisión

### Tres fuentes de costo

1. **WhatsApp message costs** — Wirer `wa_message_costs` existente:
   - Cada `EvolutionSender.enviarTexto()` y `enviarTemplate()` INSERT con `org_id`, `finca_id`, `direction`, `message_type`, `cost_usd`
   - Dentro de ventana 24h = $0 (pago flat por conversación), templates = precio Meta por tipo
   - Se agrega `org_id` a la tabla (hoy solo tiene `finca_id`)

2. **LLM call costs** — Tabla nueva `llm_call_costs`:
   - `org_id`, `finca_id`, `model`, `provider`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `trace_id`, `created_at`
   - Cada adapter lee usage real del response (Gemini: `usageMetadata`, Groq: `usage`, NVIDIA: respuesta estándar)
   - Costo se calcula con pricing table por modelo

3. **Agregación mensual** — Tabla `costo_servicio_mensual`:
   - `org_id`, `mes`, `wa_cost_usd`, `llm_cost_usd`, `infra_cost_usd`, `total_cost_usd`
   - Job pg-boss a fin de mes materializa totales

### Pricing table (modelos activos D3)

| Modelo | Input / 1M tokens | Output / 1M tokens |
|---|---|---|
| Gemini 2.5 Flash | $0.075 | $0.30 |
| Groq Llama 3.3 70B | $0.59 | $0.79 |
| NVIDIA Nemotron OCR | ~$0.16 | ~$0.16 |

## Consecuencias

**Gana:**
- Margen real por cliente: revenue (D26) - costo_servicio (D27)
- Data para optimizar pricing (flat → híbrido si costos varían mucho por cliente)
- Visibilidad de qué modelos/adapters cuestan más
- Base para alertas de gestión en D28 ("costo > revenue")

**Pierde/Riesgos:**
- Inserts adicionales en hot path (mensaje WA → INSERT cost) → latencia marginal. Mitigar: INSERT async (fire-and-forget con error log)
- Pricing de modelos cambia frecuentemente → pricing table debe ser configurable (env vars o tabla)
- `wa_message_costs` necesita `org_id` → migration ALTER TABLE + backfill desde fincas

**Próximos pasos:**
- Migration: agregar `org_id` a `wa_message_costs`
- Migration: crear `llm_call_costs` y `costo_servicio_mensual`
- Wirer EvolutionSender para INSERT post-send
- Fix token usage en adapters
- Implementar costAggregatorWorker
