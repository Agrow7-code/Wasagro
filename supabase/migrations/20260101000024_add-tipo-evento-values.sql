-- =============================================================================
-- Wasagro H0 — Parche: Ampliar tipos de evento
-- Archivo: 24-add-tipo-evento-values.sql
-- Descripción: Agrega tipos de evento usados en TypeScript pero faltantes en SQL
-- Tipos existentes: labor, insumo, plaga, clima, cosecha, gasto, observacion, nota_libre
-- Nuevos tipos: calidad, venta, inventario, infraestructura
-- Prerequisito: 01-schema-core.sql (tipo_evento enum)
-- =============================================================================

-- Agregar valores al enum tipo_evento
-- Nota: PostgreSQL no permite ALTER TYPE ... ADD VALUE dentro de una transacción
-- que haya usado el enum, por eso usamos esta forma segura.

ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'calidad';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'venta';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'inventario';
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'infraestructura';

-- Nota: 'sin_evento' es un tipo interno del clasificador que nunca se persiste,
-- por eso no se agrega al enum de base de datos.
