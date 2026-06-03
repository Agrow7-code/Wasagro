-- D23: Cal.com booking integration.
-- Adds columns to track Cal.com bookings on sdr_prospectos and extends the
-- action_taken CHECK constraint with the new webhook-driven action.

-- 1. Columns for Cal.com booking tracking
ALTER TABLE sdr_prospectos
 ADD COLUMN IF NOT EXISTS calcom_booking_id TEXT,
 ADD COLUMN IF NOT EXISTS calcom_event_type_id INTEGER,
 ADD COLUMN IF NOT EXISTS calendar_link_sent_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS booking_cancelled_at TIMESTAMPTZ;

-- Index: fast lookup when Cal.com webhook arrives with a booking_id
CREATE INDEX IF NOT EXISTS idx_sdr_prospectos_calcom_booking_id
  ON sdr_prospectos(calcom_booking_id)
  WHERE calcom_booking_id IS NOT NULL;

-- 2. Extend action_taken constraint
ALTER TABLE sdr_interacciones DROP CONSTRAINT IF EXISTS sdr_interacciones_action_taken_check;

ALTER TABLE sdr_interacciones ADD CONSTRAINT sdr_interacciones_action_taken_check
CHECK (action_taken IN (
  'continue_discovery',
  'propose_pilot',
  'handle_objection',
  'graceful_exit',
  'await_approval',
  'send_approved_draft',
  'auto_response',
  'meeting_confirmed',
  'meeting_pending',
  'triage',
  'discovery',
  'pitch',
  'close',
  'global_fallback_answered',
  'chaser_sequence_1',
  'request_pricing',
  'pdf_sent',
  'founder_override',
  'brochure_sent',
 -- D23: Cal.com webhook-driven actions
 'booking_confirmed_webhook',
 'meeting_waiting_acked',
 'booking_cancellation_logged'
));
