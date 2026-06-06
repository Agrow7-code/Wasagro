-- =============================================================================
-- Wasagro D27 — LLM call costs tracking
-- Registra costo por llamada LLM: tokens, modelo, provider, cost_usd
-- Permite calcular costo de servir por org/finca (D27)
-- =============================================================================

CREATE TABLE llm_call_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT REFERENCES organizaciones(org_id),
  finca_id TEXT REFERENCES fincas(finca_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_class TEXT NOT NULL CHECK (model_class IN ('fast', 'reasoning', 'ultra', 'ocr')),
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  trace_id TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_costs_org ON llm_call_costs(org_id);
CREATE INDEX idx_llm_costs_org_month ON llm_call_costs(org_id, created_at);
CREATE INDEX idx_llm_costs_provider ON llm_call_costs(provider, model);
CREATE INDEX idx_llm_costs_trace ON llm_call_costs(trace_id);

ALTER TABLE llm_call_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_llm_costs" ON llm_call_costs
  FOR ALL
  USING (
    org_id = (SELECT u.org_id FROM usuarios u WHERE u.id = auth.uid())
  );
