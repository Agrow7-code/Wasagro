-- =============================================================================
-- Wasagro — generation_name en llm_call_costs (granularidad por-prompt)
-- =============================================================================
-- La tabla registraba tokens/latencia/costo por modelo y model_class, pero NO
-- por prompt (qué generación: vision_describe, ocr_documento, llamar_react_iter,
-- resumen_semanal, etc.). Esa granularidad era necesaria para diagnosticar qué
-- prompt concentra el gasto de tokens/latencia (context engineering) y solo
-- existía en LangFuse. El dato ya estaba disponible en cada llamada
-- (opciones.generationName); esta migración lo persiste para análisis self-serve
-- desde Supabase.
-- =============================================================================

ALTER TABLE llm_call_costs ADD COLUMN IF NOT EXISTS generation_name TEXT;

COMMENT ON COLUMN llm_call_costs.generation_name IS
  'Nombre de la generación/prompt (ej. ocr_documento_attempt_0, llamar_react_iter_1, resumen_semanal). Permite desglosar tokens/latencia/costo por prompt.';

-- Índice para agregaciones por prompt (token/latencia/costo por generation_name).
CREATE INDEX IF NOT EXISTS idx_llm_costs_generation ON llm_call_costs(generation_name, created_at);
