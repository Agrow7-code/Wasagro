-- =============================================================================
-- Wasagro — fincas.config JSONB column
-- Migration: 20260610000063_finca-config-jsonb.sql
-- Change:    client-provisioning (D33)
--
-- T-01 / T-03 verification: confirmed that fincas has NO existing config or
-- metadata JSONB column (searched all migrations 001–061, none add such a column).
-- This migration adds it.
--
-- Purpose:
--   Stores per-farm configuration as a flexible JSONB blob. The first consumer
--   is the Sigatoka sub-pipeline (D29/D33): when cultivo_principal='banano',
--   seedFincaConfig() writes fincas.config.sigatoka_umbrales = UmbralesSeveridad.
--   EventHandler reads it back to pass per-farm thresholds to buildWhatsappSummary().
--   Falls back to UMBRALES_SEVERIDAD_DEFAULT when config is empty or key absent.
--
-- Design rationale (DECISIÓN 3, design.md):
--   sigatoka_umbrales are 4 heterogeneous trigger-thresholds across 4 distinct
--   variables — NOT levels of a single metric. umbrales_metrica (valor_min/max per
--   nivel per metrica) is the wrong model. JSONB on fincas maps 1:1 to the
--   UmbralesSeveridad shape and feeds buildWhatsappSummary() directly.
-- =============================================================================

ALTER TABLE fincas
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN fincas.config IS
  'Per-farm configuration blob. Key sigatoka_umbrales stores UmbralesSeveridad '
  'overrides (ee3a6Severo, ee2Avanzado, ee2Leve, hojasFuncionalesMin). '
  'Seeded by seedFincaConfig() at onboarding if cultivo_principal=banano. '
  'Falls back to UMBRALES_SEVERIDAD_DEFAULT when absent. See D33 (CLAUDE.md).';
