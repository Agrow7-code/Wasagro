-- Agrega pending_location_confirm y pending_excel_confirm al CHECK de sesiones_activas.
-- El código TypeScript usa estos estados para flujos de confirmación de ubicación y Excel.
-- Sin este parche, updateSession con esos valores lanza una violación de CHECK constraint.
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_status_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'pending_confirmation'::text,
    'pending_location_confirm'::text,
    'pending_excel_confirm'::text,
    'completed'::text,
    'fallback_nota_libre'::text,
    'expired'::text
  ]));
