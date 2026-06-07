-- =============================================================================
-- Wasagro — Add is_test_org flag to organizaciones
-- =============================================================================
-- Motivación (2026-06-07):
--   ORG001 (Bananera Puebloviejo, Henry Morales) es la cuenta interna de
--   pruebas. Hoy se mantiene "activa" seteándole manualmente plan='enterprise'
--   + subscription_status='active' + trial_fin='2099-12-31'. Cualquier job
--   futuro que normalice orgs (e.g. recompute_plan_status, billing reconciler)
--   podría revertir esos valores sin querer.
--
--   La columna is_test_org marca explícitamente las orgs internas/de pruebas.
--   planGuard la respeta como override: si is_test_org = true → siempre activa,
--   ignora plan/trial_fin/subscription_status. Cualquier job de normalización
--   debe excluir orgs con is_test_org = true.
--
-- Estado posterior:
--   ORG001 queda con is_test_org = true. Próximas orgs (clientes reales) se
--   crean con el default false. Para agregar otra org de pruebas, basta con
--   UPDATE organizaciones SET is_test_org = true WHERE org_id = '...';
-- =============================================================================

ALTER TABLE "public"."organizaciones"
ADD COLUMN IF NOT EXISTS "is_test_org" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."organizaciones"."is_test_org" IS
  'Si true, la org se considera activa siempre (bypass planGuard / billing checks). Usado para ORG internas de testing/QA. Default false. Los jobs de normalización deben excluir estas filas.';

-- Marcar ORG001 como org de pruebas internas
UPDATE "public"."organizaciones"
SET is_test_org = true
WHERE org_id = 'ORG001';

-- Índice parcial para consultas rápidas "todas las orgs de pago reales"
CREATE INDEX IF NOT EXISTS idx_organizaciones_billing_real
  ON "public"."organizaciones" (org_id)
  WHERE is_test_org = false;
