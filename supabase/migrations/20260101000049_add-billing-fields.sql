-- =============================================================================
-- Wasagro — Billing: enum plan_org + billing fields on organizaciones
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create plan_org enum (replaces plan TEXT)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE plan_org AS ENUM ('trial', 'free', 'starter', 'enterprise');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrate plan column from TEXT → plan_org enum
--    Strategy: add new column, backfill, drop old, rename
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 2a: Add the new enum column with a temporary name
ALTER TABLE organizaciones ADD COLUMN plan_new plan_org NOT NULL DEFAULT 'trial';

-- Step 2b: Backfill from old TEXT plan values
UPDATE organizaciones SET plan_new = 'trial'::plan_org WHERE plan = 'trial';
UPDATE organizaciones SET plan_new = 'free'::plan_org WHERE plan = 'free';
UPDATE organizaciones SET plan_new = 'starter'::plan_org WHERE plan = 'starter';
UPDATE organizaciones SET plan_new = 'enterprise'::plan_org WHERE plan = 'enterprise';
-- Default: anything unknown becomes trial (safe default — blocked after 30 days)
UPDATE organizaciones SET plan_new = 'trial'::plan_org
WHERE plan NOT IN ('trial', 'free', 'starter', 'enterprise');

-- Step 2c: Drop old, rename new
ALTER TABLE organizaciones DROP COLUMN plan;
ALTER TABLE organizaciones RENAME COLUMN plan_new TO plan;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add billing columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones ADD COLUMN trial_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organizaciones ADD COLUMN trial_fin TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');

-- Trigger to auto-compute trial_fin from trial_inicio on INSERT
CREATE OR REPLACE FUNCTION set_trial_fin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.trial_fin := NEW.trial_inicio + INTERVAL '30 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_trial_fin
  BEFORE INSERT ON organizaciones
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_fin();
ALTER TABLE organizaciones ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizaciones ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE organizaciones ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none'
  CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'none'));
ALTER TABLE organizaciones ADD COLUMN plan_activo_desde TIMESTAMPTZ;
ALTER TABLE organizaciones ADD COLUMN plan_cancelado_en TIMESTAMPTZ;
ALTER TABLE organizaciones ADD COLUMN metodo_pago TEXT
  CHECK (metodo_pago IS NULL OR metodo_pago IN ('stripe', 'deuna', 'transferencia'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Set trial_inicio for existing orgs (use created_at as baseline)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE organizaciones SET trial_inicio = created_at
WHERE created_at < NOW() - INTERVAL '1 second';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes for billing queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_organizaciones_plan ON organizaciones(plan);
CREATE INDEX idx_organizaciones_stripe_customer ON organizaciones(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_organizaciones_subscription_status ON organizaciones(subscription_status) WHERE subscription_status != 'none';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Helper function: is_org_billing_active
--    Returns true if org can use paid features.
--    trial + within 30 days = OK, starter/enterprise + active subscription = OK
-- ─────────────────────────────────────────────────────────────────────────────
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
      (plan = 'trial' AND trial_fin > NOW())
      OR (plan IN ('starter', 'enterprise') AND subscription_status = 'active')
    )
)
$$;
