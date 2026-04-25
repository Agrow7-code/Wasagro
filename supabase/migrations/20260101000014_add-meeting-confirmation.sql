-- =============================================================================
-- Wasagro H0 — Meeting confirmation support
-- Amplía los CHECK constraints de sdr_interacciones para el nuevo
-- controlador handleMeetingConfirmation.
-- =============================================================================

-- tipo: agrega 'meeting_confirmation' (mensaje del prospecto confirmando reunión)
ALTER TABLE sdr_interacciones
  DROP CONSTRAINT sdr_interacciones_tipo_check,
  ADD CONSTRAINT sdr_interacciones_tipo_check CHECK (tipo IN (
    'inbound',
    'outbound',
    'draft_approval',
    'founder_override',
    'meeting_confirmation'
  ));

-- action_taken: agrega 'meeting_confirmed' y 'meeting_pending'
ALTER TABLE sdr_interacciones
  DROP CONSTRAINT sdr_interacciones_action_taken_check,
  ADD CONSTRAINT sdr_interacciones_action_taken_check CHECK (action_taken IN (
    'continue_discovery',
    'propose_pilot',
    'handle_objection',
    'graceful_exit',
    'await_approval',
    'send_approved_draft',
    'auto_response',
    'meeting_confirmed',
    'meeting_pending'
  ));
