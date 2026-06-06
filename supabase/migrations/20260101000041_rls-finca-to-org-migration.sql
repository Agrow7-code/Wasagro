-- =============================================================================
-- Wasagro — Security: RLS policies finca_id → org_id migration
--
-- PROBLEM: Several RLS policies use `u.finca_id FROM usuarios u WHERE u.id = auth.uid()`
-- which restricts users to ONLY the finca assigned in their `usuarios` row.
-- This breaks multi-finca organizations where a user should see ALL fincas in their org.
--
-- FIX: Replace all finca_id-based user policies with org_id-based policies
-- using the existing get_user_org_id() SECURITY DEFINER function.
-- Add service_role bypass so the backend pipeline still works.
-- All sections are idempotent: skip if table doesn't exist yet.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. usuarios — drop old finca-based, keep org_isolation_usuarios, add service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "usuarios_own_finca" ON usuarios;
DROP POLICY IF EXISTS "org_isolation_usuarios" ON usuarios;

CREATE POLICY "org_isolation_usuarios" ON usuarios
FOR ALL
USING (auth.role() = 'service_role' OR org_id = get_user_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fincas — drop old finca-based, keep org_isolation_fincas, add service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "fincas_by_user" ON fincas;
DROP POLICY IF EXISTS "org_isolation_fincas" ON fincas;

CREATE POLICY "org_isolation_fincas" ON fincas
FOR ALL
USING (auth.role() = 'service_role' OR org_id = get_user_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. lotes — drop old finca-based, keep org_isolation_lotes, add service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lotes_by_finca" ON lotes;
DROP POLICY IF EXISTS "org_isolation_lotes" ON lotes;

CREATE POLICY "org_isolation_lotes" ON lotes
FOR ALL
USING (
  auth.role() = 'service_role'
  OR finca_id IN (
    SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. eventos_campo — drop old finca-based, keep org_isolation_eventos, add service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "eventos_by_finca" ON eventos_campo;
DROP POLICY IF EXISTS "org_isolation_eventos" ON eventos_campo;

CREATE POLICY "org_isolation_eventos" ON eventos_campo
FOR ALL
USING (
  auth.role() = 'service_role'
  OR finca_id IN (
    SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. mensajes_entrada — was finca_id-based, migrate to org_id + service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mensajes_by_finca" ON mensajes_entrada;
DROP POLICY IF EXISTS "mensajes_org_isolation" ON mensajes_entrada;

CREATE POLICY "mensajes_org_isolation" ON mensajes_entrada
FOR ALL
USING (
  auth.role() = 'service_role'
  OR finca_id IN (
    SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. inventario_insumos — was finca_id-based, migrate to org_id + service_role
--    Guard: skip if table doesn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventario_insumos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "inventario_by_finca" ON inventario_insumos';
    EXECUTE 'DROP POLICY IF EXISTS "inventario_org_isolation" ON inventario_insumos';
    EXECUTE 'CREATE POLICY "inventario_org_isolation" ON inventario_insumos FOR ALL USING (
      auth.role() = ''service_role''
      OR finca_id IN (SELECT finca_id FROM fincas WHERE org_id = get_user_org_id())
    )';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. wa_message_costs — was finca_id-based, migrate to org_id + service_role
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "costs_by_finca" ON wa_message_costs;
DROP POLICY IF EXISTS "costs_org_isolation" ON wa_message_costs;

CREATE POLICY "costs_org_isolation" ON wa_message_costs
FOR ALL
USING (
  auth.role() = 'service_role'
  OR finca_id IN (
    SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. metricas_finca — was finca_id via join, migrate to org_id + service_role
--    Guard: skip if table doesn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metricas_finca') THEN
    EXECUTE 'DROP POLICY IF EXISTS metricas_finca_select ON metricas_finca';
    EXECUTE 'DROP POLICY IF EXISTS metricas_finca_insert ON metricas_finca';
    EXECUTE 'DROP POLICY IF EXISTS metricas_finca_update ON metricas_finca';
    EXECUTE 'DROP POLICY IF EXISTS metricas_finca_delete ON metricas_finca';

    EXECUTE 'CREATE POLICY metricas_finca_select ON metricas_finca
      FOR SELECT USING (auth.role() = ''service_role'' OR org_id = get_user_org_id())';
    EXECUTE 'CREATE POLICY metricas_finca_insert ON metricas_finca
      FOR INSERT WITH CHECK (auth.role() = ''service_role'' OR org_id = get_user_org_id())';
    EXECUTE 'CREATE POLICY metricas_finca_update ON metricas_finca
      FOR UPDATE USING (auth.role() = ''service_role'' OR org_id = get_user_org_id())';
    EXECUTE 'CREATE POLICY metricas_finca_delete ON metricas_finca
      FOR DELETE USING (auth.role() = ''service_role'' OR org_id = get_user_org_id())';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. umbrales_metrica — was finca_id via join, migrate to org_id + service_role
--    Guard: skip if table doesn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'umbrales_metrica') THEN
    EXECUTE 'DROP POLICY IF EXISTS umbrales_select ON umbrales_metrica';
    EXECUTE 'DROP POLICY IF EXISTS umbrales_insert ON umbrales_metrica';
    EXECUTE 'DROP POLICY IF EXISTS umbrales_update ON umbrales_metrica';

    EXECUTE 'CREATE POLICY umbrales_select ON umbrales_metrica
      FOR SELECT USING (auth.role() = ''service_role'' OR finca_id IN (SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()))';
    EXECUTE 'CREATE POLICY umbrales_insert ON umbrales_metrica
      FOR INSERT WITH CHECK (auth.role() = ''service_role'' OR finca_id IN (SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()))';
    EXECUTE 'CREATE POLICY umbrales_update ON umbrales_metrica
      FOR UPDATE USING (auth.role() = ''service_role'' OR finca_id IN (SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()))';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. resultados_metricas — was finca_id via join, migrate to org_id + service_role
--     Guard: skip if table doesn't exist yet
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'resultados_metricas') THEN
    EXECUTE 'DROP POLICY IF EXISTS resultados_select ON resultados_metricas';
    EXECUTE 'CREATE POLICY resultados_select ON resultados_metricas
      FOR SELECT USING (auth.role() = ''service_role'' OR finca_id IN (SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()))';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. organizaciones — add service_role bypass
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_select" ON organizaciones;
DROP POLICY IF EXISTS "org_isolation_organizaciones" ON organizaciones;

CREATE POLICY "org_isolation_organizaciones" ON organizaciones
FOR ALL
USING (auth.role() = 'service_role' OR org_id = get_user_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. sesiones_activas — add org_id based policy + service_role bypass
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sesiones_by_finca" ON sesiones_activas;
DROP POLICY IF EXISTS "sesiones_org_isolation" ON sesiones_activas;

CREATE POLICY "sesiones_org_isolation" ON sesiones_activas
FOR ALL
USING (
  auth.role() = 'service_role'
  OR finca_id IN (
    SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. user_consents — add service_role bypass (was user-only)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "consents_own_user" ON user_consents;
DROP POLICY IF EXISTS "consents_service_or_own" ON user_consents;

CREATE POLICY "consents_service_or_own" ON user_consents
FOR ALL
USING (auth.role() = 'service_role' OR user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. otp_codes — add service_role bypass (was phone-only restrictive)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "otp_own_phone" ON otp_codes;
DROP POLICY IF EXISTS "otp_service_access" ON otp_codes;

CREATE POLICY "otp_service_access" ON otp_codes
FOR ALL
USING (auth.role() = 'service_role');
