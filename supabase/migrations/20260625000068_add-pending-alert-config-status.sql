-- T1.2: Add 'pending_alert_config' to the sesiones_activas CHECK constraint.
-- Migration 067 already added 'pending_sigatoka_aclaracion'; this migration adds
-- the status that the configurable-alert-thresholds feature will write when a
-- decision-maker's config conversation is in progress (PR#3 / T3.6).
-- DROP + ADD is the only way to update a CHECK (proven by migrations 025/067).
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_status_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'pending_confirmation'::text,
    'pending_location_confirm'::text,
    'pending_excel_confirm'::text,
    'pending_sigatoka_aclaracion'::text,
    'pending_alert_config'::text,
    'processing_intentions'::text,
    'completed'::text,
    'fallback_nota_libre'::text,
    'expired'::text
  ]));
