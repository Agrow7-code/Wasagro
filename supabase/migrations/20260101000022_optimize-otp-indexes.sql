-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIMIZACIÓN: Índices compuestos para OTP codes
-- Mejora la velocidad de las queries de rate limiting y verificación
-- ─────────────────────────────────────────────────────────────────────────────

-- Índice compuesto para rate limiting: phone + created_at
-- La query de rate limiting filtra por phone y busca created_at > X
DROP INDEX IF EXISTS idx_otp_phone_created_at;
CREATE INDEX idx_otp_phone_created_at 
ON otp_codes(phone, created_at DESC);

-- Índice para verificación de código activo
-- La query busca phone + used=false + expires_at > now
DROP INDEX IF EXISTS idx_otp_active_codes;
CREATE INDEX idx_otp_active_codes 
ON otp_codes(phone, used, expires_at DESC) 
WHERE used = false;

-- Índice para limpieza de códigos expirados
-- La query delete busca phone + expires_at < now
DROP INDEX IF EXISTS idx_otp_expired_cleanup;
CREATE INDEX idx_otp_expired_cleanup 
ON otp_codes(phone, expires_at) 
WHERE expires_at < NOW();

-- Analizar tabla para que el query planner use los nuevos índices
ANALYZE otp_codes;
