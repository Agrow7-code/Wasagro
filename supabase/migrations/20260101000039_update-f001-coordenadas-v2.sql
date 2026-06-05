-- Actualizar centroide de F001 con coordenadas más precisas
UPDATE fincas
SET coordenadas = ST_SetSRID(ST_MakePoint(-79.545617, -1.758744), 4326)::geography
WHERE finca_id = 'F001';
