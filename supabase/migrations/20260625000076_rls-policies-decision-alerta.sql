-- Fix 3 (cont.): RLS policy for decision_alerta.
-- Table has RLS ENABLED (migration 070) but no policy → deny-all via PostgREST.
-- Backend uses service_role for all access (same pattern as migration 075 / 061).
-- Kept in its own file so the supabase CLI splitter cannot merge it with the
-- umbrales_alerta policy (SQLSTATE 42601 on adjacent multi-line-paren statements).
CREATE POLICY decision_alerta_service_only
ON decision_alerta
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
