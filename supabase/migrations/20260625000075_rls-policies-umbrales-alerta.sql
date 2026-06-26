-- Fix 3: RLS policy for umbrales_alerta.
-- Table has RLS ENABLED (migration 069) but no policy → deny-all via PostgREST.
-- Backend uses service_role for all access, so a service_role-only policy is the correct
-- pattern (same as sigatoka_correcciones, migration 061). One CREATE POLICY per file: the
-- supabase CLI splitter merges adjacent multi-line-paren statements (SQLSTATE 42601), so
-- the decision_alerta policy lives in migration 076.
CREATE POLICY umbrales_alerta_service_only
ON umbrales_alerta
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
