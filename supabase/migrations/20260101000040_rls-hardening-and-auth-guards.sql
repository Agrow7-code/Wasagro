-- =============================================================================
-- Wasagro — Security: RLS hardening + SECURITY DEFINER auth checks
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on prospectos (was missing — leads table accessible to anyone)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE prospectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY prospectos_service_only
ON prospectos
FOR ALL
USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Enable RLS on plan_de_cuentas (was missing — financial data exposed)
--     Guard: skip if table doesn't exist yet (created in a future migration)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_de_cuentas') THEN
    ALTER TABLE plan_de_cuentas ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_de_cuentas') THEN
    CREATE POLICY plan_de_cuentas_service_or_org
    ON plan_de_cuentas
    FOR ALL
    USING (auth.role() = 'service_role' OR org_id = get_user_org_id())
    WITH CHECK (auth.role() = 'service_role' OR org_id = get_user_org_id());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix SDR tables: USING (true) → service_role only
-- Migration 028 replaced the correct auth.role() = 'service_role' with USING (true)
-- which effectively disabled RLS entirely.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sdr_prospectos_service_access ON sdr_prospectos;
CREATE POLICY sdr_prospectos_service_access
ON sdr_prospectos
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS sdr_interacciones_service_access ON sdr_interacciones;
CREATE POLICY sdr_interacciones_service_access
ON sdr_interacciones
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add auth guard to SECURITY DEFINER functions
-- These functions run as the table owner (postgres), bypassing RLS.
-- Without auth checks, any anon user calling them directly gets full access.
-- ─────────────────────────────────────────────────────────────────────────────

-- get_user_org_id() — add guard: must be authenticated
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
$$;

-- insertar_lote — add guard: must be service_role or authenticated user in same org
-- Drop first if signature changed (cannot change return type of existing function)
DROP FUNCTION IF EXISTS insertar_lote(TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);
CREATE OR REPLACE FUNCTION insertar_lote(
  p_lote_id TEXT,
  p_finca_id TEXT,
  p_nombre TEXT,
  p_hectareas NUMERIC,
  p_lat_c DOUBLE PRECISION,
  p_lng_c DOUBLE PRECISION,
  p_polygon_wkt TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id TEXT;
  v_new_id UUID;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM fincas WHERE finca_id = p_finca_id AND org_id = v_org_id) THEN
      RAISE EXCEPTION 'Sin acceso a la finca %', p_finca_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Autenticación requerida para insertar_lote';
  END IF;

  INSERT INTO lotes (lote_id, finca_id, nombre, hectareas, lat_c, lng_c, poligono)
  VALUES (
    p_lote_id, p_finca_id, p_nombre, p_hectareas, p_lat_c, p_lng_c,
    ST_SetSRID(ST_GeomFromText(p_polygon_wkt), 4326)
  )
  RETURNING lote_id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- get_finca_centroide — add guard: must be service_role or user in same org
DROP FUNCTION IF EXISTS get_finca_centroide(TEXT);
CREATE OR REPLACE FUNCTION get_finca_centroide(p_finca_id TEXT)
RETURNS TABLE(finca_id TEXT, nombre TEXT, lat_c DOUBLE PRECISION, lng_c DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_org_id TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM fincas WHERE finca_id = p_finca_id AND org_id = v_org_id) THEN
      RAISE EXCEPTION 'Sin acceso a la finca %', p_finca_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Autenticación requerida para get_finca_centroide';
  END IF;

  RETURN QUERY
  SELECT f.finca_id, f.nombre, f.lat_c, f.lng_c
  FROM fincas f
  WHERE f.finca_id = p_finca_id;
END;
$$;

-- update_finca_coordenadas — add guard
DROP FUNCTION IF EXISTS update_finca_coordenadas(TEXT, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION update_finca_coordenadas(
  p_finca_id TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
    IF NOT EXISTS (SELECT 1 FROM fincas WHERE finca_id = p_finca_id AND org_id = v_org_id) THEN
      RAISE EXCEPTION 'Sin acceso a la finca %', p_finca_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Autenticación requerida para update_finca_coordenadas';
  END IF;

  UPDATE fincas SET lat_c = p_lat, lng_c = p_lng WHERE finca_id = p_finca_id;
END;
$$;

-- eliminar_lote — add guard: must be service_role or user with access to lote's finca
DROP FUNCTION IF EXISTS eliminar_lote(TEXT);
CREATE OR REPLACE FUNCTION eliminar_lote(p_lote_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id   TEXT;
  v_finca_id TEXT;
BEGIN
  SELECT finca_id INTO v_finca_id FROM lotes WHERE lote_id = p_lote_id;
  IF v_finca_id IS NULL THEN
    RAISE EXCEPTION 'Lote % no existe', p_lote_id;
  END IF;

  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
    IF NOT EXISTS (
      SELECT 1 FROM fincas WHERE finca_id = v_finca_id AND org_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'Sin acceso al lote %', p_lote_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Autenticación requerida para eliminar_lote';
  END IF;

  UPDATE lotes SET activo = false, updated_at = NOW() WHERE lote_id = p_lote_id;
END;
$$;

-- get_fincas_con_coordenadas — add guard
DROP FUNCTION IF EXISTS get_fincas_con_coordenadas();
CREATE OR REPLACE FUNCTION get_fincas_con_coordenadas()
RETURNS TABLE(finca_id TEXT, nombre TEXT, lat_c DOUBLE PRECISION, lng_c DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_org_id TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Autenticación requerida para get_fincas_con_coordenadas';
  END IF;

  IF v_org_id IS NOT NULL THEN
    RETURN QUERY
    SELECT f.finca_id, f.nombre, f.lat_c, f.lng_c
    FROM fincas f
    WHERE f.org_id = v_org_id;
  ELSE
    RETURN QUERY
    SELECT f.finca_id, f.nombre, f.lat_c, f.lng_c
    FROM fincas f;
  END IF;
END;
$$;
