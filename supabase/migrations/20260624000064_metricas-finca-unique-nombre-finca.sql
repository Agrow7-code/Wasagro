-- Fix 2: Add UNIQUE constraint on (nombre, finca_id) in metricas_finca.
-- Without this, upsert with onConflict:'nombre,finca_id' silently falls back
-- to INSERT → duplicate rows on re-seed. The constraint is safe to add because
-- metricas_finca rows are created per-farm and nombre is the human-readable key
-- within that farm scope. If a conflict already exists (data integrity issue),
-- the migration will fail visibly rather than silently corrupt data.
ALTER TABLE metricas_finca
  ADD CONSTRAINT uq_metricas_finca_nombre_finca_id UNIQUE (nombre, finca_id);
