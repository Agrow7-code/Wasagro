-- =============================================================================
-- Wasagro — Fix check_sdr_node_values to include 'global_fallback'
-- =============================================================================
-- Root cause (2026-06-06 prod incident):
--   fsmStateToLegacySDRNode() maps SDRFsmState 'dormant' and 'declined' to the
--   legacy node 'global_fallback'. Migration 30 created
--   check_sdr_node_values as CHECK (sdr_node IN
--   ('triage','discovery','pitch','close')) — 'global_fallback' was missing.
--   Real prospect with cultivo='arroz' triggered the out-of-scope branch,
--   FSM moved to 'dormant', and the UPDATE failed with SQLSTATE 23514.
--   The catch sent the "Disculpá, tuve un problemita" message to a real lead.
-- =============================================================================

ALTER TABLE "public"."sdr_prospectos"
DROP CONSTRAINT IF EXISTS check_sdr_node_values;

ALTER TABLE "public"."sdr_prospectos"
ADD CONSTRAINT check_sdr_node_values
CHECK (sdr_node IN ('triage', 'discovery', 'pitch', 'close', 'global_fallback'));
