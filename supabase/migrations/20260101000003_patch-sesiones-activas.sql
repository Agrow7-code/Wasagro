-- =============================================================================
-- Wasagro H0 — Parche: Sesiones activas
-- Archivo: backend/sql/03-patch-sesiones-activas.sql
-- Prioridad: BLOQUEANTE OPERATIVO (R2 — máx 2 clarificaciones)
-- Descripción: Estado de sesión conversacional. TTL 30 minutos.
--              Soporta tipo 'reporte' (clarificaciones) y 'onboarding' (pasos).
-- Prerequisito: 01-schema-core.sql
-- =============================================================================

CREATE TABLE sesiones_activas (
    session_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone               TEXT NOT NULL,
    finca_id            TEXT REFERENCES fincas(finca_id),
    tipo_sesion         TEXT NOT NULL CHECK (tipo_sesion IN ('reporte', 'onboarding')),
    clarification_count INTEGER DEFAULT 0 CHECK (clarification_count >= 0 AND clarification_count <= 2),
    paso_onboarding     INTEGER,                                     -- 1-5, solo si tipo_sesion='onboarding'
    contexto_parcial    JSONB DEFAULT '{}',                          -- Extracción incompleta o datos de pasos previos
    ultimo_mensaje_at   TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes'),
    status              TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'fallback_nota_libre', 'expired')),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Índice principal: buscar sesión activa por teléfono (query más frecuente del pipeline)
CREATE INDEX idx_sesiones_phone_status ON sesiones_activas(phone, status) WHERE status = 'active';

-- Índice para GC periódico de sesiones expiradas
CREATE INDEX idx_sesiones_expires ON sesiones_activas(expires_at) WHERE status = 'active';

ALTER TABLE sesiones_activas ENABLE ROW LEVEL SECURITY;

-- Las sesiones se gestionan exclusivamente por service_role (n8n).
-- No hay acceso directo del usuario autenticado a esta tabla.
-- RLS habilitado pero sin política para auth.uid() — solo service_role opera esta tabla.
