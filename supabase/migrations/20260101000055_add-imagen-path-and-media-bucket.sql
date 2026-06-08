-- =============================================================================
-- Wasagro — Persistencia de la imagen original de un evento de campo
-- =============================================================================
-- Hasta ahora el base64 de cada imagen (plaga, documento, muestreo Sigatoka) se
-- procesaba y se descartaba. Sin la imagen original no hay auditoría del input
-- (P5: todo evento conserva su "raw" — para una ficha por visión, el raw ES la
-- foto), ni revisión humana de un requires_review, ni re-captura con contexto.
--
-- Esta migración agrega:
--   1. Columna eventos_campo.imagen_path → ruta del objeto en Storage (no URL
--      pública: la URL firmada se genera server-side al leer, ver D5/P5).
--   2. Bucket PRIVADO 'eventos-media' (public=false). Los datos son de la finca
--      (P5) — nunca acceso anónimo. El acceso de lectura se hace con el cliente
--      service_role del backend, que genera signed URLs cuando haga falta.
-- =============================================================================

ALTER TABLE eventos_campo ADD COLUMN IF NOT EXISTS imagen_path TEXT;

COMMENT ON COLUMN eventos_campo.imagen_path IS
  'Ruta del objeto en el bucket Storage eventos-media (ej. F001/uuid.jpg). NULL si no hubo imagen o el upload falló. La URL firmada se genera server-side al leer.';

INSERT INTO storage.buckets (id, name, public)
VALUES ('eventos-media', 'eventos-media', false)
ON CONFLICT (id) DO NOTHING;
