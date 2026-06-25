-- T1.4: CREATE TABLE decision_alerta — tracks ask/decision state per (org, finca, pest).
-- Prevents infinite nag (B2, design §2.3, §4.2).
-- status lifecycle: not_asked → asked → decided | opted_out (terminal).
CREATE TABLE decision_alerta (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT        NOT NULL REFERENCES organizaciones(org_id),
  finca_id     TEXT        NOT NULL REFERENCES fincas(finca_id),
  pest_type    TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'not_asked'
                           CHECK (status IN ('not_asked', 'asked', 'decided', 'opted_out')),
  asked_at     TIMESTAMPTZ,
  ask_count    INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_decision_alerta UNIQUE (org_id, finca_id, pest_type)
);

CREATE INDEX idx_decision_alerta_lookup
  ON decision_alerta (org_id, finca_id, pest_type);

CREATE TRIGGER trg_decision_alerta_updated_at
  BEFORE UPDATE ON decision_alerta
  FOR EACH ROW EXECUTE FUNCTION wasagro_set_updated_at();

ALTER TABLE decision_alerta ENABLE ROW LEVEL SECURITY;
