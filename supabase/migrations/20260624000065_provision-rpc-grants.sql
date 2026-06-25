-- REVOKE EXECUTE FROM PUBLIC on provisionar_cliente_atomico (Fix 1 — CRITICAL, D31).
-- PostgreSQL grants EXECUTE to PUBLIC by default on new functions, which would let
-- anon/authenticated call this SECURITY DEFINER RPC via PostgREST and bypass
-- REPORTE_SECRET (fail-closed). Single statement per file: the supabase CLI splitter
-- merges adjacent statements (SQLSTATE 42601), so REVOKE and GRANT are kept separate.
REVOKE EXECUTE ON FUNCTION provisionar_cliente_atomico(TEXT, tipo_org, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;
