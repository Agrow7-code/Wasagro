-- Asegura que el service_role tenga acceso total a las tablas de SDR.
-- El backend usa la service_role key y necesita saltarse o cumplir el RLS.

DROP POLICY IF EXISTS sdr_prospectos_service_only ON sdr_prospectos;
CREATE POLICY sdr_prospectos_service_access 
  ON sdr_prospectos FOR ALL 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS sdr_interacciones_service_only ON sdr_interacciones;
CREATE POLICY sdr_interacciones_service_access 
  ON sdr_interacciones FOR ALL 
  USING (true) 
  WITH CHECK (true);
