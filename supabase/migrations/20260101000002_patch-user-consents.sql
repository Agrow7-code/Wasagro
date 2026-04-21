-- =============================================================================
-- Wasagro H0 — Parche: Consentimientos de usuario
-- Archivo: backend/sql/02-patch-user-consents.sql
-- Prioridad: BLOQUEANTE LEGAL (P6)
-- Descripción: Tabla de consentimientos documentados. Sin esta tabla no se puede
--              capturar ningún dato legalmente. Cada consentimiento registra el
--              texto exacto mostrado al usuario y su respuesta.
-- Prerequisito: 01-schema-core.sql
-- =============================================================================

CREATE TABLE user_consents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    phone          TEXT NOT NULL,
    tipo           TEXT NOT NULL CHECK (tipo IN ('datos', 'comunicaciones', 'ubicacion')),
    texto_mostrado TEXT NOT NULL,                                    -- Texto EXACTO que se le mostró al usuario
    aceptado       BOOLEAN NOT NULL,
    ip_address     TEXT,                                             -- Opcional, si disponible
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- No UPDATE ni DELETE — cada cambio de consentimiento es un nuevo INSERT (auditoría inmutable).
-- Para obtener el consentimiento vigente: SELECT ... ORDER BY created_at DESC LIMIT 1

CREATE INDEX idx_consents_user     ON user_consents(user_id);
CREATE INDEX idx_consents_phone    ON user_consents(phone);
CREATE INDEX idx_consents_tipo_user ON user_consents(user_id, tipo, created_at DESC);

ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consents_own_user" ON user_consents
    FOR ALL
    USING (user_id = auth.uid());
