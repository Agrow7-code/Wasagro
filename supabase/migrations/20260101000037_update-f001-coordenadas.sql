-- Centroide real de la finca F001 (Pimocha, Babahoyo, Ecuador)
UPDATE fincas
SET coordenadas = ST_SetSRID(ST_MakePoint(-79.546017, -1.759785), 4326)::geography
WHERE finca_id = 'F001';
