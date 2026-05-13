-- Funciones RPC para insertar/eliminar lotes con polígonos PostGIS
-- Usadas desde el editor de finca en el dashboard.

CREATE OR REPLACE FUNCTION insertar_lote(
  p_lote_id     TEXT,
  p_finca_id    TEXT,
  p_nombre      TEXT,
  p_hectareas   NUMERIC,
  p_lat_c       DOUBLE PRECISION,
  p_lng_c       DOUBLE PRECISION,
  p_polygon_wkt TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO lotes (lote_id, finca_id, nombre_coloquial, hectareas, coordenadas, poligono, activo)
  VALUES (
    p_lote_id,
    p_finca_id,
    p_nombre,
    p_hectareas,
    ST_SetSRID(ST_MakePoint(p_lng_c, p_lat_c), 4326)::geography,
    ST_SetSRID(ST_GeomFromText(p_polygon_wkt), 4326)::geography,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION eliminar_lote(p_lote_id TEXT) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE lotes SET activo = false, updated_at = NOW() WHERE lote_id = p_lote_id;
END;
$$;
