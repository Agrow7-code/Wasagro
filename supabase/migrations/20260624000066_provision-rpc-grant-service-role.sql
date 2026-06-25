-- GRANT EXECUTE to service_role on provisionar_cliente_atomico (Fix 1 — CRITICAL, D31).
-- After REVOKE FROM PUBLIC (migration 065), service_role needs an explicit grant so the
-- backend (service-role key) can still call the provisioning RPC. Single statement per
-- file: the supabase CLI splitter merges adjacent statements (SQLSTATE 42601).
GRANT EXECUTE ON FUNCTION provisionar_cliente_atomico(TEXT, tipo_org, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO service_role;
