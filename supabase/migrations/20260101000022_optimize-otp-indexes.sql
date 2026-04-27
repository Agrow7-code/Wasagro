-- Optimización de índices para Login y OTP
CREATE INDEX IF NOT EXISTS idx_usuarios_phone_active ON usuarios(phone) WHERE status = 'activo';
CREATE INDEX IF NOT EXISTS idx_otp_codes_lookup ON otp_codes(phone, used, expires_at);
ANALYZE usuarios;
ANALYZE otp_codes;
