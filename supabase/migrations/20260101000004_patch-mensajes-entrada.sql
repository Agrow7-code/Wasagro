-- =============================================================================
-- Wasagro H0 — Parche: Mensajes de entrada
-- Archivo: backend/sql/04-patch-mensajes-entrada.sql
-- Prioridad: BLOQUEANTE (idempotencia contra reintentos de Meta Cloud API)
-- Descripción: Log de mensajes entrantes. wa_message_id UNIQUE garantiza
--              idempotencia contra reintentos de Meta Cloud API (<20s window).
--              También agrega el FK constraint en eventos_campo.mensaje_id.
-- Prerequisito: 01-schema-core.sql
-- =============================================================================

CREATE TABLE mensajes_entrada (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_message_id    TEXT NOT NULL UNIQUE,                           -- wamid.XXX — clave de idempotencia
    phone            TEXT NOT NULL,
    finca_id         TEXT REFERENCES fincas(finca_id),
    tipo_mensaje     TEXT NOT NULL CHECK (tipo_mensaje IN ('text', 'audio', 'image')),
    contenido_raw    TEXT,                                           -- Texto crudo, transcripción STT, o caption
    media_ref        TEXT,                                           -- media_id de WhatsApp (válido 30 días)
    evento_id        UUID REFERENCES eventos_campo(id),              -- Vincula al evento generado (nullable)
    status           TEXT DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'error', 'duplicate')),
    langfuse_trace_id TEXT,                                          -- Referencia a traza LangFuse
    error_detail     TEXT,                                           -- Detalle de error si status='error'
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mensajes_wamid   ON mensajes_entrada(wa_message_id);
CREATE INDEX idx_mensajes_phone   ON mensajes_entrada(phone);
CREATE INDEX idx_mensajes_status  ON mensajes_entrada(status);
CREATE INDEX idx_mensajes_finca   ON mensajes_entrada(finca_id);
CREATE INDEX idx_mensajes_created ON mensajes_entrada(created_at);

ALTER TABLE mensajes_entrada ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mensajes_by_finca" ON mensajes_entrada
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- Agregar FK en eventos_campo ahora que mensajes_entrada existe
-- (eventos_campo.mensaje_id fue creada sin constraint FK en 01-schema-core.sql)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE eventos_campo
    ADD CONSTRAINT fk_eventos_mensaje
    FOREIGN KEY (mensaje_id) REFERENCES mensajes_entrada(id);
