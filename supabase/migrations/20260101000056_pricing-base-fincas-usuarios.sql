-- =============================================================================
-- Wasagro — Pricing v2 step 1: add new enum values + columns
-- =============================================================================

ALTER TYPE plan_org ADD VALUE IF NOT EXISTS 'agricultor' BEFORE 'free';
ALTER TYPE plan_org ADD VALUE IF NOT EXISTS 'productor' BEFORE 'free';
ALTER TYPE plan_org ADD VALUE IF NOT EXISTS 'pyme' BEFORE 'free';
ALTER TYPE plan_org ADD VALUE IF NOT EXISTS 'corporativo' BEFORE 'free';

ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS fincas_contratadas INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS usuarios_contratados INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizaciones ADD COLUMN IF NOT EXISTS precio_mensual INTEGER;

CREATE INDEX IF NOT EXISTS idx_organizaciones_precio_mensual ON organizaciones(precio_mensual) WHERE precio_mensual IS NOT NULL;
