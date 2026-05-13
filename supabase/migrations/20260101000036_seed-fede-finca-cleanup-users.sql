-- Finca F002: soja en Córdoba, Argentina — para Federico
INSERT INTO fincas (finca_id, nombre, ubicacion, pais, cultivo_principal, coordenadas, activa)
VALUES (
  'F002',
  'Finca Soja Córdoba',
  'Córdoba, Argentina',
  'AR',
  'soja',
  ST_SetSRID(ST_MakePoint(-64.668425, -33.874661), 4326)::geography,
  true
)
ON CONFLICT (finca_id) DO NOTHING;

-- Fede pasa a propietario de su propia finca
UPDATE usuarios
SET rol = 'propietario', finca_id = 'F002'
WHERE phone = '5492914474555';

-- Desactivar cuenta "Admin Banano" (soft-delete)
UPDATE usuarios SET status = 'inactivo' WHERE phone = '593987310830';

-- Henry Morales: sacar el sufijo _OLD
UPDATE usuarios
SET phone = '593987310830'
WHERE phone = '593987310830_OLD';
