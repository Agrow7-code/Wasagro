-- Agrega pending_confirmation al CHECK de status en sesiones_activas.
-- Necesario para el flujo de confirmación antes de guardar eventos.
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_status_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'pending_confirmation'::text,
    'completed'::text,
    'fallback_nota_libre'::text,
    'expired'::text
  ]));
