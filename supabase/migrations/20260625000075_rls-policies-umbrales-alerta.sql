-- Fix 3: RLS policies for umbrales_alerta and decision_alerta.
-- Both tables have RLS ENABLED (migration 069/070) but no policies → deny-all via PostgREST.
-- The backend uses service_role for all access, so a service_role-only policy
-- is the correct pattern (same as sigatoka_correcciones in migration 061).
-- Model: migration 20260610000061_add-sigatoka-correcciones.sql

CREATE POLICY umbrales_alerta_service_only
ON umbrales_alerta
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY decision_alerta_service_only
ON decision_alerta
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
