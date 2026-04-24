-- =============================================================================
-- Wasagro H0 — SDR Interacciones
-- Log inmutable de cada turno del agente SDR por prospecto.
-- =============================================================================

CREATE TABLE sdr_interacciones (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospecto_id        UUID NOT NULL REFERENCES sdr_prospectos(id) ON DELETE CASCADE,
  phone               TEXT NOT NULL,

  -- Posición en la conversación
  turno               INTEGER NOT NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN (
    'inbound',           -- mensaje del prospecto
    'outbound',          -- respuesta del SDR
    'draft_approval',    -- notificación enviada al founder para aprobación
    'founder_override'   -- el founder reemplazó el draft con su propio texto
  )),

  -- Contenido del mensaje
  contenido           TEXT NOT NULL,

  -- Score en este turno
  score_before        INTEGER CHECK (score_before BETWEEN 0 AND 100),
  score_after         INTEGER CHECK (score_after BETWEEN 0 AND 100),
  score_delta         JSONB, -- {eudr_urgency: 0, tamano_cartera: 15, ...}

  -- Metadata de la interacción
  objection_detected  TEXT,  -- null o ID de la objeción (ej: 'sin_presupuesto')
  action_taken        TEXT CHECK (action_taken IN (
    'continue_discovery',
    'propose_pilot',
    'handle_objection',
    'graceful_exit',
    'await_approval',
    'send_approved_draft',
    'auto_response'
  )),
  narrativa           TEXT CHECK (narrativa IN ('A', 'B')),
  segmento_icp        TEXT,

  -- Trazabilidad
  langfuse_trace_id   TEXT,
  session_id          UUID, -- referencia a sesiones_activas.session_id

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_sdr_int_prospecto ON sdr_interacciones (prospecto_id);
CREATE INDEX idx_sdr_int_phone ON sdr_interacciones (phone);
CREATE INDEX idx_sdr_int_created ON sdr_interacciones (created_at DESC);
CREATE INDEX idx_sdr_int_tipo ON sdr_interacciones (tipo);

-- RLS: solo service_role
ALTER TABLE sdr_interacciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdr_interacciones_service_only
  ON sdr_interacciones
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comentario: esta tabla es append-only por diseño.
-- Nunca se actualiza un registro existente — cada turno crea una nueva fila.
-- El historial completo permite auditoría y re-entrenamiento del SDR.
