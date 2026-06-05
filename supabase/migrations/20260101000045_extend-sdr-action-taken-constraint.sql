-- FIX-7: extend sdr_interacciones.action_taken CHECK constraint.
--
-- Renamed from 20260101000040_ to 20260101000045_ on 2026-06-04 to resolve a
-- numeric prefix collision with 20260101000040_rls-hardening-and-auth-guards.sql.
-- The migration is fully idempotent (DROP IF EXISTS + ADD with the full allowed
-- list), so it is safe to re-apply in any environment where the old name was
-- already committed to supabase_migrations.schema_migrations — the existing
-- constraint gets dropped and recreated with the same shape.
--
-- The handlers in sdrAgent.ts have been writing values that were never on the
-- allowed list:
--   * handleFounderApproval writes 'founder_override' when the founder replies
--     with custom text (not si/no) — the message is forwarded to the prospect
--     as-is and we log it.
--   * handleMeetingConfirmation writes 'brochure_sent' when the prospect asks
--     for the brochure instead of agendar reunion.
--
-- Both inserts have been failing the CHECK constraint in prod since the values
-- were introduced. Tests didn't catch it because saveSDRInteraccion is mocked.
-- Migration 31/32 are the prior versions; this is the additive extension.

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
    'triage',
    'discovery',
    'pitch',
    'close',
    'global_fallback_answered',
    'chaser_sequence_1',
    'request_pricing',
    'pdf_sent',
    -- Added in FIX-7 (2026-06-01)
    'founder_override',
    'brochure_sent'
  ));
