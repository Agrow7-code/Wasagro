-- Devuelve los datos básicos de una finca con lat/lng como números
CREATE OR REPLACE FUNCTION get_finca_centroide(p_finca_id TEXT)
RETURNS TABLE(
  finca_id          TEXT,
  nombre            TEXT,
  ubicacion         TEXT,
  pais              TEXT,
  cultivo_principal TEXT,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    finca_id,
    nombre,
    ubicacion,
    pais,
    cultivo_principal,
    ST_Y(coordenadas::geometry) AS lat,
    ST_X(coordenadas::geometry) AS lng
  FROM fincas
  WHERE finca_id = p_finca_id
    AND activa = true;
$$;
