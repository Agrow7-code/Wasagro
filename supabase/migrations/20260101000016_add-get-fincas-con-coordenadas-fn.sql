-- Devuelve todas las fincas activas que ya tienen coordenadas registradas,
-- con lat/lng extraídos como números para uso directo en APIs meteorológicas.
CREATE OR REPLACE FUNCTION get_fincas_con_coordenadas()
RETURNS TABLE(
  finca_id         TEXT,
  nombre           TEXT,
  cultivo_principal TEXT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    finca_id,
    nombre,
    cultivo_principal,
    ST_Y(coordenadas::geometry) AS lat,
    ST_X(coordenadas::geometry) AS lng
  FROM fincas
  WHERE activa = true
    AND coordenadas IS NOT NULL;
$$;
