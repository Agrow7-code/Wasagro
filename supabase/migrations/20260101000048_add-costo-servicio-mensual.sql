-- =============================================================================
-- Wasagro D27 — Monthly cost aggregation per org
-- Materialized by pg-boss job at end of month
-- Sum of wa_message_costs + llm_call_costs per org/month
-- =============================================================================

CREATE TABLE costo_servicio_mensual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizaciones(org_id),
  mes TEXT NOT NULL,
  wa_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  llm_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  infra_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  wa_messages_count INTEGER NOT NULL DEFAULT 0,
  llm_calls_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, mes)
);

CREATE INDEX idx_costo_mensual_org ON costo_servicio_mensual(org_id);
CREATE INDEX idx_costo_mensual_mes ON costo_servicio_mensual(mes);

ALTER TABLE costo_servicio_mensual ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_costo_mensual" ON costo_servicio_mensual
  FOR ALL
  USING (
    org_id = (SELECT u.org_id FROM usuarios u WHERE u.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION aggregate_monthly_costs(target_mes TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO costo_servicio_mensual (org_id, mes, wa_cost_usd, llm_cost_usd, total_cost_usd, wa_messages_count, llm_calls_count, updated_at)
  SELECT
    wa.org_id,
    target_mes,
    COALESCE(SUM(wa.cost_usd), 0),
    COALESCE((SELECT SUM(llm.cost_usd) FROM llm_call_costs llm WHERE llm.org_id = wa.org_id AND to_char(llm.created_at, 'YYYY-MM') = target_mes), 0),
    COALESCE(SUM(wa.cost_usd), 0) + COALESCE((SELECT SUM(llm.cost_usd) FROM llm_call_costs llm WHERE llm.org_id = wa.org_id AND to_char(llm.created_at, 'YYYY-MM') = target_mes), 0),
    COUNT(*),
    COALESCE((SELECT COUNT(*) FROM llm_call_costs llm WHERE llm.org_id = wa.org_id AND to_char(llm.created_at, 'YYYY-MM') = target_mes), 0),
    NOW()
  FROM wa_message_costs wa
  WHERE to_char(wa.created_at, 'YYYY-MM') = target_mes
    AND wa.org_id IS NOT NULL
  GROUP BY wa.org_id
  ON CONFLICT (org_id, mes) DO UPDATE SET
    wa_cost_usd = EXCLUDED.wa_cost_usd,
    llm_cost_usd = EXCLUDED.llm_cost_usd,
    total_cost_usd = EXCLUDED.total_cost_usd,
    wa_messages_count = EXCLUDED.wa_messages_count,
    llm_calls_count = EXCLUDED.llm_calls_count,
    updated_at = NOW();
END;
$$;
