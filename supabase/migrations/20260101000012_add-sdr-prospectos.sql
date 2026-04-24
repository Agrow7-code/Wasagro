-- =============================================================================
-- Wasagro H0 — SDR Prospectos
-- Tabla principal para el agente SDR conversacional.
-- =============================================================================

CREATE TABLE sdr_prospectos (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone                     TEXT NOT NULL UNIQUE,

  -- Datos de contacto (extraídos por el LLM a lo largo de la conversación)
  nombre                    TEXT,
  empresa                   TEXT,
  cargo                     TEXT,
  pais                      TEXT,

  -- Segmentación ICP
  segmento_icp              TEXT CHECK (segmento_icp IN (
    'exportadora', 'ong', 'gerente_finca', 'otro', 'desconocido'
  )) NOT NULL DEFAULT 'desconocido',

  -- Narrativa A/B asignada aleatoriamente en creación
  narrativa_asignada        TEXT CHECK (narrativa_asignada IN ('A', 'B')) NOT NULL,

  -- ── Score de calificación ───────────────────────────────────────────────────
  score_total               INTEGER NOT NULL DEFAULT 0 CHECK (score_total BETWEEN 0 AND 100),
  score_eudr_urgency        INTEGER NOT NULL DEFAULT 0 CHECK (score_eudr_urgency BETWEEN 0 AND 25),
  score_tamano_cartera      INTEGER NOT NULL DEFAULT 0 CHECK (score_tamano_cartera BETWEEN 0 AND 20),
  score_calidad_dato        INTEGER NOT NULL DEFAULT 0 CHECK (score_calidad_dato BETWEEN 0 AND 20),
  score_champion            INTEGER NOT NULL DEFAULT 7 CHECK (score_champion BETWEEN 0 AND 15),
  score_timeline_decision   INTEGER NOT NULL DEFAULT 0 CHECK (score_timeline_decision BETWEEN 0 AND 10),
  score_presupuesto         INTEGER NOT NULL DEFAULT 5 CHECK (score_presupuesto BETWEEN 0 AND 10),

  -- ── Discovery tracking ──────────────────────────────────────────────────────
  -- Array append-only de {question_id, question_text, answer_text, dimension, score_delta, evidence_quote, turn, session_id, answered_at}
  preguntas_realizadas      JSONB NOT NULL DEFAULT '[]',
  fincas_en_cartera         INTEGER,
  cultivo_principal         TEXT,
  eudr_urgency_nivel        TEXT CHECK (eudr_urgency_nivel IN (
    'alta', 'media', 'baja', 'ninguna', 'desconocida'
  )) NOT NULL DEFAULT 'desconocida',
  sistema_actual            TEXT,
  objeciones_manejadas      TEXT[] DEFAULT '{}',
  punto_de_dolor_principal  TEXT,

  -- ── Estado del proceso ──────────────────────────────────────────────────────
  status                    TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',
    'en_discovery',
    'qualified',
    'unqualified',
    'piloto_propuesto',
    'reunion_agendada',
    'dormant',
    'descartado'
  )),
  turns_total               INTEGER NOT NULL DEFAULT 0,
  primera_interaccion       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_interaccion        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ── Handoff ─────────────────────────────────────────────────────────────────
  deal_brief                JSONB,
  founder_notified_at       TIMESTAMPTZ,
  reunion_agendada_at       TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: mantener score_total como suma de las 6 dimensiones
CREATE OR REPLACE FUNCTION sdr_actualizar_score_total()
RETURNS TRIGGER AS $$
BEGIN
  NEW.score_total := NEW.score_eudr_urgency
                   + NEW.score_tamano_cartera
                   + NEW.score_calidad_dato
                   + NEW.score_champion
                   + NEW.score_timeline_decision
                   + NEW.score_presupuesto;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sdr_score_total
BEFORE INSERT OR UPDATE OF
  score_eudr_urgency,
  score_tamano_cartera,
  score_calidad_dato,
  score_champion,
  score_timeline_decision,
  score_presupuesto
ON sdr_prospectos
FOR EACH ROW EXECUTE FUNCTION sdr_actualizar_score_total();

-- Índices
CREATE INDEX idx_sdr_prospectos_phone ON sdr_prospectos (phone);
CREATE INDEX idx_sdr_prospectos_status ON sdr_prospectos (status);
CREATE INDEX idx_sdr_prospectos_score ON sdr_prospectos (score_total DESC);
CREATE INDEX idx_sdr_prospectos_segmento ON sdr_prospectos (segmento_icp);

-- RLS: solo service_role accede (el backend usa service_role key)
ALTER TABLE sdr_prospectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdr_prospectos_service_only
  ON sdr_prospectos
  FOR ALL
  USING (auth.role() = 'service_role');
