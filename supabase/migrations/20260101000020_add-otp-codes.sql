-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: otp_codes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used BOOLEAN DEFAULT FALSE,
    intentos INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);

-- RLS: solo el backend puede leer/escribir. 
-- Como el backend usa service_role, no necesitamos políticas para que funcione el pipeline.
-- Sin embargo, habilitamos RLS por seguridad general.
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
