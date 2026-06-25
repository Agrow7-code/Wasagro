-- HOTFIX: add 'pending_sigatoka_aclaracion' to the sesiones_activas status CHECK.
-- EventHandler.ts writes this status (lines ~525/894) to open the Sigatoka "preguntar
-- al tomador" follow-up (D29), but no migration ever added it to the CHECK constraint
-- (latest was migration 025). Every such updateSession violated the constraint, so the
-- Sigatoka clarification round-trip could never persist its session state in prod.
-- Additive + reversible. (pending_alert_config — for configurable-alert-thresholds —
-- is added later by that change's PR#1, when code starts writing it.)
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_status_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'pending_confirmation'::text,
    'pending_location_confirm'::text,
    'pending_excel_confirm'::text,
    'pending_sigatoka_aclaracion'::text,
    'processing_intentions'::text,
    'completed'::text,
    'fallback_nota_libre'::text,
    'expired'::text
  ]));
