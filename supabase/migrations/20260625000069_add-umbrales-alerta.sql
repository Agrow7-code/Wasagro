-- T1.3: CREATE TABLE umbrales_alerta — relational store for per-pest alert thresholds.
-- One row per (org_id, finca_id|NULL, pest_type, campo). finca_id NULL = org-level default.
-- NULL-safe uniqueness (H8, design §2.1-2.2): a STORED generated column finca_scope
-- backs a real named UNIQUE constraint so Supabase upsert onConflict resolves it
-- (functional indexes cannot be referenced by PostgREST upsert).
CREATE TABLE umbrales_alerta (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT        NOT NULL REFERENCES organizaciones(org_id),
  finca_id     TEXT        REFERENCES fincas(finca_id),
  -- NULL-safe scope key: NULL finca_id → '*' (org default); per-finca → finca_id value.
  finca_scope  TEXT        GENERATED ALWAYS AS (COALESCE(finca_id, '*')) STORED,
  pest_type    TEXT        NOT NULL,
  campo        TEXT        NOT NULL,
  operador     TEXT        NOT NULL DEFAULT 'gt'
                           CHECK (operador IN ('gt', 'gte', 'lt', 'lte')),
  valor        NUMERIC     NOT NULL,
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  updated_by   UUID        REFERENCES usuarios(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_umbrales_alerta_scope
    UNIQUE (org_id, finca_scope, pest_type, campo)
);

CREATE INDEX idx_umbrales_alerta_resolve
  ON umbrales_alerta (pest_type, org_id, finca_id);

-- Reuse the project-wide wasagro_set_updated_at() function (migration 033).
-- No new CREATE FUNCTION here (splitter rule: one function per file, last statement).
CREATE TRIGGER trg_umbrales_alerta_updated_at
  BEFORE UPDATE ON umbrales_alerta
  FOR EACH ROW EXECUTE FUNCTION wasagro_set_updated_at();

ALTER TABLE umbrales_alerta ENABLE ROW LEVEL SECURITY;
