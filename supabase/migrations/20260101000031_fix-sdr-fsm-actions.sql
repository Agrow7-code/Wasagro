-- Update the action_taken constraint to support the new FSM nodes and operational actions
ALTER TABLE "public"."sdr_interacciones" DROP CONSTRAINT IF EXISTS sdr_interacciones_action_taken_check;

ALTER TABLE "public"."sdr_interacciones" ADD CONSTRAINT sdr_interacciones_action_taken_check
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
    -- New FSM Nodes & Ops Actions
    'triage',
    'discovery',
    'pitch',
    'close',
    'global_fallback_answered',
    'chaser_sequence_1',
    'request_pricing'
  ));
