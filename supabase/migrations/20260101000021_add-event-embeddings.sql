-- Enable pgvector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to eventos_campo
ALTER TABLE eventos_campo
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- IVFFlat index for cosine similarity — 100 lists is appropriate for < 1M rows
CREATE INDEX IF NOT EXISTS eventos_campo_embedding_idx
  ON eventos_campo
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC function: semantic similarity search scoped to a finca
CREATE OR REPLACE FUNCTION buscar_eventos_similares(
  p_finca_id   TEXT,
  p_embedding  vector(1024),
  p_limit      INT     DEFAULT 5,
  p_threshold  FLOAT   DEFAULT 0.75
)
RETURNS TABLE (
  id              UUID,
  tipo_evento     TEXT,
  descripcion_raw TEXT,
  fecha_evento    DATE,
  similitud       FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    tipo_evento::TEXT,
    descripcion_raw,
    fecha_evento,
    1 - (embedding <=> p_embedding) AS similitud
  FROM eventos_campo
  WHERE
    finca_id   = p_finca_id
    AND embedding IS NOT NULL
    AND tipo_evento != 'sin_evento'
    AND 1 - (embedding <=> p_embedding) >= p_threshold
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$;
