-- =============================================================================
-- Wasagro — Análisis de costo/latencia/tokens de LLM ("medir primero")
-- =============================================================================
-- Queries READ-ONLY para correr en el SQL editor de Supabase. Fuente: tabla
-- llm_call_costs (tokens REALES por llamada). La columna generation_name
-- (migración 060) permite el desglose POR PROMPT, que es lo que hace falta para
-- diagnosticar dónde está el "context bloat" antes de optimizar nada.
--
-- Nota: las filas previas a la migración 060 tienen generation_name = NULL.
-- Filtrá por created_at posterior al despliegue de 060 para análisis por-prompt.
-- =============================================================================

-- 0) ¿Hay datos suficientes para concluir algo? Volumen y rango temporal.
SELECT count(*)                         AS llamadas,
       count(DISTINCT trace_id)         AS mensajes_aprox,
       min(created_at)                  AS desde,
       max(created_at)                  AS hasta,
       round(sum(cost_usd)::numeric, 4) AS costo_total_usd
FROM llm_call_costs;

-- 1) POR PROMPT (generation_name): el desglose clave para cazar bloat.
--    p95 de tokens de entrada = el prompt más "pesado" de contexto.
SELECT generation_name,
       count(*)                                   AS llamadas,
       round(avg(prompt_tokens))                  AS in_tok_avg,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY prompt_tokens) AS in_tok_p95,
       round(avg(completion_tokens))              AS out_tok_avg,
       round(avg(latency_ms))                     AS lat_ms_avg,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)    AS lat_ms_p95,
       round(sum(cost_usd)::numeric, 4)           AS costo_usd
FROM llm_call_costs
WHERE generation_name IS NOT NULL
GROUP BY generation_name
ORDER BY sum(prompt_tokens) DESC;   -- los que más tokens de contexto consumen primero

-- 2) POR TIER (model_class): dónde se concentra el gasto y la latencia.
SELECT model_class,
       count(*)                                   AS llamadas,
       round(avg(prompt_tokens))                  AS in_tok_avg,
       round(avg(latency_ms))                     AS lat_ms_avg,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS lat_ms_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS lat_ms_p95,
       round(sum(cost_usd)::numeric, 4)           AS costo_usd
FROM llm_call_costs
GROUP BY model_class
ORDER BY costo_usd DESC;

-- 3) POR MODELO: qué modelo del pool se usa realmente y cuánto cuesta.
SELECT provider, model,
       count(*)                          AS llamadas,
       round(avg(latency_ms))            AS lat_ms_avg,
       round(sum(cost_usd)::numeric, 4)  AS costo_usd,
       sum(total_tokens)                 AS tokens_total
FROM llm_call_costs
GROUP BY provider, model
ORDER BY llamadas DESC;

-- 4) MODELOS EN $0: detecta modelos sin precio en MODEL_PRICING (subconteo de P&L).
--    Si aparecen filas con tokens > 0 y costo 0, falta su precio en la tabla.
SELECT model, count(*) AS llamadas, sum(total_tokens) AS tokens
FROM llm_call_costs
WHERE cost_usd = 0 AND total_tokens > 0
GROUP BY model
ORDER BY tokens DESC;

-- 5) COSTO POR MENSAJE (proxy por trace_id): cuántas llamadas LLM y cuánto cuesta
--    procesar un mensaje entrante de punta a punta. Detecta mensajes caros.
SELECT trace_id,
       count(*)                          AS llamadas_llm,
       sum(total_tokens)                 AS tokens,
       round(sum(cost_usd)::numeric, 5)  AS costo_usd,
       max(created_at)                   AS cuando
FROM llm_call_costs
WHERE trace_id IS NOT NULL
GROUP BY trace_id
ORDER BY sum(cost_usd) DESC
LIMIT 25;

-- 6) COSTO POR ORG (D27/D28): para el P&L del back-office, últimos 30 días.
SELECT org_id,
       count(*)                          AS llamadas,
       round(sum(cost_usd)::numeric, 4)  AS costo_usd_30d
FROM llm_call_costs
WHERE org_id IS NOT NULL AND created_at > now() - interval '30 days'
GROUP BY org_id
ORDER BY costo_usd_30d DESC;
