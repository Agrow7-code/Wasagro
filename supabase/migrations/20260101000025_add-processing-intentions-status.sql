-- Agrega processing_intentions al CHECK de sesiones_activas.
-- Requerido por ADR 006 (Initiator-Sub-Agent) para marcar cuando una sesión
-- está esperando que pg-boss procese las intenciones en background.
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_status_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'pending_confirmation'::text,
    'pending_location_confirm'::text,
    'pending_excel_confirm'::text,
    'processing_intentions'::text,
    'completed'::text,
    'fallback_nota_libre'::text,
    'expired'::text
  ]));
