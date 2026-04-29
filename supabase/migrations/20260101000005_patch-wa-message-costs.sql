-- =============================================================================
-- Wasagro H0 — Parche: Tracking de costos WhatsApp
-- Archivo: backend/sql/05-patch-wa-message-costs.sql
-- Descripción: Registra costo por mensaje WhatsApp enviado/recibido.
-- Permite medir costo real por finca para el modelo de negocio.
-- En H0 con Evolution API (D6), mensajes dentro de ventana 24h = $0.
-- Solo templates fuera de ventana tienen costo.
-- Prerequisito: 01-schema-core.sql
-- ACTUALIZADO: Eliminada referencia a Meta Cloud API (usamos Evolution API)
-- =============================================================================

CREATE TABLE wa_message_costs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finca_id          TEXT REFERENCES fincas(finca_id),
    phone             TEXT,
    direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type      TEXT NOT NULL CHECK (message_type IN ('text', 'audio', 'image', 'template', 'reaction')),
    conversation_type TEXT CHECK (conversation_type IN ('user_initiated', 'business_initiated')),
    cost_usd          NUMERIC(10,6) DEFAULT 0,                       -- Costo en USD (6 decimales)
    wa_message_id     TEXT,                                          -- Referencia al wamid
    metadata          JSONB DEFAULT '{}',                            -- Nombre de template, etc.
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_costs_finca       ON wa_message_costs(finca_id);
CREATE INDEX idx_costs_created     ON wa_message_costs(created_at);
CREATE INDEX idx_costs_finca_month ON wa_message_costs(finca_id, created_at);

ALTER TABLE wa_message_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "costs_by_finca" ON wa_message_costs
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );
