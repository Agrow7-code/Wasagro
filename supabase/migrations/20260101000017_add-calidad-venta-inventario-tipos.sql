-- Nuevos tipos de evento para expansión de dominio
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'calidad';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'venta';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'inventario';
