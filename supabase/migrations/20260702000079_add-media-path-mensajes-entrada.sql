-- Adds media_path to mensajes_entrada: the Storage object path (eventos-media
-- bucket, sdr/ prefix) for SDR prospect audio/image inbound messages, so the
-- founder-crm inbox thread can render the original media instead of a text
-- placeholder. Additive, safe. NULL for text messages and for any media that
-- failed to download/upload (best-effort ingest, P4) or predates this change
-- (no backfill).
ALTER TABLE mensajes_entrada ADD COLUMN IF NOT EXISTS media_path TEXT;
