-- =============================================================================
-- Wasagro — dLocal Go: correct column names for Go API (not classic dLocal)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add dLocal Go columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones ADD COLUMN dlocalgo_payment_id TEXT;
ALTER TABLE organizaciones ADD COLUMN dlocalgo_checkout_token TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrate data from old dlocal columns if any exists
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE organizaciones SET dlocalgo_payment_id = dlocal_payment_id WHERE dlocal_payment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Update metodo_pago CHECK constraint: 'dlocal' → 'dlocalgo'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones DROP CONSTRAINT organizaciones_metodo_pago_check;
ALTER TABLE organizaciones ADD CONSTRAINT organizaciones_metodo_pago_check
  CHECK (metodo_pago IS NULL OR metodo_pago IN ('dlocalgo', 'deuna', 'transferencia'));

UPDATE organizaciones SET metodo_pago = 'dlocalgo' WHERE metodo_pago = 'dlocal';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop old dlocal columns and indexes (replaced by dlocalgo_*)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_organizaciones_dlocal_card_id;
DROP INDEX IF EXISTS idx_organizaciones_dlocal_payment_id;
ALTER TABLE organizaciones DROP COLUMN IF EXISTS dlocal_payment_id;
ALTER TABLE organizaciones DROP COLUMN IF EXISTS dlocal_card_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes for dLocal Go queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_organizaciones_dlocalgo_payment_id ON organizaciones(dlocalgo_payment_id) WHERE dlocalgo_payment_id IS NOT NULL;
CREATE INDEX idx_organizaciones_dlocalgo_checkout_token ON organizaciones(dlocalgo_checkout_token) WHERE dlocalgo_checkout_token IS NOT NULL;
