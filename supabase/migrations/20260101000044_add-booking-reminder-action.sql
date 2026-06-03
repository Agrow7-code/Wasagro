-- D24: Booking reminder action for the 24h differentiated chaser.
-- The sdrChaserWorker now has two modes: generic re-engagement (chaser_sequence_1)
-- and targeted booking reminder (booking_reminder_24h) when the prospect received
-- the calendar link but hasn't booked after 24h.

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
 'booking_confirmed_webhook',
 'meeting_waiting_acked',
 'booking_cancellation_logged',
 -- D24: 24h booking reminder (sent when calendar_link_sent_at > 24h and no booking)
 'booking_reminder_24h'
));
