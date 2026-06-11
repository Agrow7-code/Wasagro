-- =============================================================================
-- Wasagro — Endurecimiento de seguridad: vistas, funciones y search_path
-- =============================================================================
-- Cierra hallazgos de la auditoría de seguridad (capa BD):
--   1. v_eventos_analisis exponía descripcion_raw + costos de TODAS las fincas
--      (una VIEW sin security_invoker corre con privilegios del owner y no
--      aplica la RLS de eventos_campo al rol consultante). P5: aislamiento por
--      finca. → Recrear con security_invoker = on para que la RLS aplique.
--   2. buscar_eventos_similares aceptaba cualquier p_finca_id sin verificar que
--      el llamante sea dueño → lectura cross-tenant de descripcion_raw.
--   3. get_fincas_con_coordenadas: si el usuario autenticado no tenía org_id,
--      caía a un branch que devolvía TODAS las fincas (fuga cross-tenant).
--   4. Ninguna función SECURITY DEFINER fijaba search_path → riesgo de
--      search-path hijacking. Se pinea en todas las del schema public.
-- =============================================================================

-- ── 1. Vista de análisis con security_invoker (respeta RLS del consultante) ──
CREATE OR REPLACE VIEW v_eventos_analisis
WITH (security_invoker = on) AS
SELECT
    e.id,
    e.finca_id,
    e.lote_id,
    l.nombre_coloquial as lote_nombre,
    e.tipo_evento,
    e.status,
    e.fecha_evento,
    e.descripcion_raw,
    (e.datos_evento->>'individuos_encontrados')::NUMERIC as plaga_individuos,
    (e.datos_evento->>'tamano_muestra')::NUMERIC as plaga_muestra,
    e.datos_evento->>'organo_afectado' as plaga_organo,
    e.datos_evento->>'nombre_comun' as plaga_nombre,
    CASE
        WHEN (e.datos_evento->>'tamano_muestra')::NUMERIC > 0
        THEN ROUND(((e.datos_evento->>'individuos_encontrados')::NUMERIC / (e.datos_evento->>'tamano_muestra')::NUMERIC) * 100, 2)
        ELSE 0
    END as plaga_severidad_pct,
    (e.datos_evento->>'monto')::NUMERIC as costo_monto,
    e.datos_evento->>'categoria' as costo_categoria,
    e.created_at
FROM eventos_campo e
LEFT JOIN lotes l ON e.lote_id = l.lote_id;

-- Defensa en profundidad: el rol anónimo nunca debe leer esta vista.
REVOKE ALL ON v_eventos_analisis FROM anon;

-- ── 2. buscar_eventos_similares con guard de pertenencia (anti cross-tenant) ──
DROP FUNCTION IF EXISTS buscar_eventos_similares(TEXT, vector, INT, FLOAT);
CREATE OR REPLACE FUNCTION buscar_eventos_similares(
  p_finca_id   TEXT,
  p_embedding  vector(1024),
  p_limit      INT     DEFAULT 5,
  p_threshold  FLOAT   DEFAULT 0.75
)
RETURNS TABLE (
  id              UUID,
  tipo_evento     TEXT,
  descripcion_raw TEXT,
  fecha_evento    DATE,
  similitud       FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id TEXT;
BEGIN
  -- service_role (backend) opera con finca_id ya validado en la capa de app.
  -- Para un usuario autenticado, exigir que la finca pertenezca a su organización.
  IF auth.role() <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Autenticación requerida';
    END IF;
    SELECT u.org_id INTO v_org_id FROM usuarios u WHERE u.id = auth.uid() LIMIT 1;
    IF v_org_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM fincas f WHERE f.finca_id = p_finca_id AND f.org_id = v_org_id) THEN
      RAISE EXCEPTION 'Sin acceso a la finca %', p_finca_id;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.tipo_evento::TEXT,
    e.descripcion_raw,
    e.fecha_evento,
    1 - (e.embedding <=> p_embedding) AS similitud
  FROM eventos_campo e
  WHERE
    e.finca_id   = p_finca_id
    AND e.embedding IS NOT NULL
    AND e.tipo_evento != 'sin_evento'
    AND 1 - (e.embedding <=> p_embedding) >= p_threshold
  ORDER BY e.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;

-- ── 3. get_fincas_con_coordenadas: cerrar el fall-through de org nula ────────
CREATE OR REPLACE FUNCTION get_fincas_con_coordenadas()
RETURNS TABLE(finca_id TEXT, nombre TEXT, lat_c DOUBLE PRECISION, lng_c DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id TEXT;
  v_is_service BOOLEAN := (auth.role() = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Autenticación requerida para get_fincas_con_coordenadas';
    END IF;
    SELECT org_id INTO v_org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
    -- Usuario autenticado sin organización: NO devolver nada (antes filtraba todo).
    IF v_org_id IS NULL THEN
      RETURN;
    END IF;
    RETURN QUERY
      SELECT f.finca_id, f.nombre, f.lat_c, f.lng_c
      FROM fincas f
      WHERE f.org_id = v_org_id;
    RETURN;
  END IF;

  -- service_role: acceso completo (backend de confianza).
  RETURN QUERY
    SELECT f.finca_id, f.nombre, f.lat_c, f.lng_c
    FROM fincas f;
END;
$$;

-- ── 4. Pinear search_path en TODA función SECURITY DEFINER del schema public ─
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;

-- ── 5. Nota sobre Storage (bucket eventos-media) ─────────────────────────────
-- El bucket es privado (public=false, migr. 055) y NO tiene políticas en
-- storage.objects → por defecto anon/authenticated tienen acceso DENEGADO. El
-- backend lee con service_role y firma URLs server-side (D30). No se añade
-- política permisiva aquí a propósito: cualquier política futura sobre
-- storage.objects debe ser explícitamente scoped a bucket_id='eventos-media'
-- y al rol service_role/organización dueña, nunca abierta a anon.
