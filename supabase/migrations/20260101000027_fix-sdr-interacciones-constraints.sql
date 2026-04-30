-- Actualiza los CHECK constraints de sdr_interacciones para permitir nuevos tipos y acciones.
-- Requerido para flujos de confirmación de reuniones y nuevos estados del SDR.

ALTER TABLE sdr_interacciones DROP CONSTRAINT sdr_interacciones_tipo_check;
ALTER TABLE sdr_interacciones ADD CONSTRAINT sdr_interacciones_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'inbound'::text,
    'outbound'::text,
    'draft_approval'::text,
    'founder_override'::text,
    'meeting_confirmation'::text
  ]));

ALTER TABLE sdr_interacciones DROP CONSTRAINT sdr_interacciones_action_taken_check;
ALTER TABLE sdr_interacciones ADD CONSTRAINT sdr_interacciones_action_taken_check
  CHECK (action_taken = ANY (ARRAY[
    'continue_discovery'::text,
    'propose_pilot'::text,
    'handle_objection'::text,
    'graceful_exit'::text,
    'await_approval'::text,
    'send_approved_draft'::text,
    'auto_response'::text,
    'meeting_confirmed'::text,
    'meeting_pending'::text
  ]));
