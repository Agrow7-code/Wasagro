-- =============================================================================
-- Wasagro D27 — Add org_id to wa_message_costs + RLS org-scoped
-- Prerequisito: 05-patch-wa-message-costs.sql, 07-add-organizaciones.sql
-- =============================================================================

ALTER TABLE wa_message_costs ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizaciones(org_id);

CREATE INDEX IF NOT EXISTS idx_costs_org ON wa_message_costs(org_id);
CREATE INDEX IF NOT EXISTS idx_costs_org_month ON wa_message_costs(org_id, created_at);

DROP POLICY IF EXISTS "costs_by_finca" ON wa_message_costs;

CREATE POLICY "org_isolation_wa_costs" ON wa_message_costs
  FOR ALL
  USING (
    org_id = (SELECT u.org_id FROM usuarios u WHERE u.id = auth.uid())
  );
