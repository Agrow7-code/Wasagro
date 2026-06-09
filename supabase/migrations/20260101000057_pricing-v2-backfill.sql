-- =============================================================================
-- Wasagro — Pricing v2 step 2: backfill old plans + update billing function
-- Must be a separate migration because Postgres won't let you use a new enum
-- value in the same transaction that created it.
-- =============================================================================

UPDATE organizaciones SET plan = 'productor'::plan_org WHERE plan = 'starter'::plan_org;
UPDATE organizaciones SET plan = 'pyme'::plan_org WHERE plan = 'enterprise'::plan_org;

CREATE OR REPLACE FUNCTION is_org_billing_active(p_org_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizaciones
    WHERE org_id = p_org_id
    AND (
      is_test_org = true
      OR (plan = 'trial'::plan_org AND trial_fin > NOW())
      OR (plan IN ('agricultor'::plan_org, 'productor'::plan_org, 'pyme'::plan_org, 'corporativo'::plan_org) AND subscription_status = 'active')
      OR (plan IN ('starter'::plan_org, 'enterprise'::plan_org) AND subscription_status = 'active')
    )
  )
$$;
