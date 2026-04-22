-- Agrega valores al enum tipo_evento que el pipeline nuevo requiere
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'infraestructura';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'sin_evento';
