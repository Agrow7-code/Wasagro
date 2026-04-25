-- Función RPC para actualizar coordenadas de finca con PostGIS
-- Usada cuando el agricultor comparte su ubicación por WhatsApp.
CREATE OR REPLACE FUNCTION update_finca_coordenadas(
  p_finca_id TEXT,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE fincas
  SET coordenadas = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      updated_at  = NOW()
  WHERE finca_id = p_finca_id;
END;
$$;
