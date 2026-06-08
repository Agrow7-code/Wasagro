-- =============================================================================
-- Wasagro — Replace Stripe with dLocal Go: update billing fields
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add dLocal columns (replace stripe_customer_id / stripe_subscription_id)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones ADD COLUMN dlocal_payment_id TEXT;
ALTER TABLE organizaciones ADD COLUMN dlocal_card_id TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Update metodo_pago CHECK constraint to include 'dlocal'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones DROP CONSTRAINT organizaciones_metodo_pago_check;
ALTER TABLE organizaciones ADD CONSTRAINT organizaciones_metodo_pago_check
  CHECK (metodo_pago IS NULL OR metodo_pago IN ('dlocal', 'deuna', 'transferencia'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Migrate existing stripe-paying orgs: set metodo_pago = 'dlocal' where
--    metodo_pago was 'stripe' (no data loss — just re-label the gateway)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE organizaciones SET metodo_pago = 'dlocal' WHERE metodo_pago = 'stripe';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop Stripe-specific columns (no longer used)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_organizaciones_stripe_customer;
ALTER TABLE organizaciones DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE organizaciones DROP COLUMN IF EXISTS stripe_subscription_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes for dLocal queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_organizaciones_dlocal_card_id ON organizaciones(dlocal_card_id) WHERE dlocal_card_id IS NOT NULL;
CREATE INDEX idx_organizaciones_dlocal_payment_id ON organizaciones(dlocal_payment_id) WHERE dlocal_payment_id IS NOT NULL;
