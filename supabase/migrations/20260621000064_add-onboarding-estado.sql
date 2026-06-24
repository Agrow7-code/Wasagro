-- =============================================================================
-- Wasagro — Onboarding hardening: durable onboarding state + breadcrumbs
-- Archivo: 64-add-onboarding-estado.sql
-- Change: onboarding-hardening (PR-A foundation)
-- =============================================================================
-- El ruteo del pipeline gira sobre usuarios.onboarding_completo (durable), no
-- sobre sesiones_activas (efímera, TTL 30min, GC). Para representar onboardings
-- trabados/terminales sin el limbo del hallazgo #1, agregamos un eje propio
-- (onboarding_estado) ortogonal a onboarding_completo (boolean) y a status
-- (activo/pendiente_aprobacion/inactivo = eje de activación de cuenta).
-- Además capturamos migas durables para el futuro funnel (las sesiones se borran).
-- =============================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS onboarding_estado TEXT NOT NULL DEFAULT 'no_iniciado'
    CHECK (onboarding_estado IN (
      'no_iniciado',            -- creado, nunca escribió
      'en_progreso',            -- onboarding activo
      'esperando_explicacion',  -- datos listos; estado transitorio de 1 turno (Opción B)
      'completo',               -- terminó OK (espeja onboarding_completo=true)
      'requiere_revision',      -- techo de pasos / límite de intentos → intervención humana
      'rechazo_consentimiento'  -- rechazó P6 → terminal, founder notificado
    ));

-- Migas de métricas (sesiones GC'd → capturar acá)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS onboarding_iniciado_at   TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS onboarding_completado_at TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS paso_trabado             INTEGER;

-- Tracking del re-nudge de aprobación del agricultor (worker pg-boss, PR-D)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprobacion_recordatorios INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_recordatorio_at   TIMESTAMPTZ;

-- Backfill conservador: nadie se marca trabado retroactivamente.
UPDATE usuarios
  SET onboarding_estado    = 'completo',
      onboarding_completado_at = COALESCE(onboarding_completado_at, updated_at)
  WHERE onboarding_completo = true;

UPDATE usuarios
  SET onboarding_estado = 'en_progreso'
  WHERE onboarding_completo = false AND onboarding_estado = 'no_iniciado';

-- Índice para escanear onboardings trabados / pendientes (query del back-office)
CREATE INDEX IF NOT EXISTS idx_usuarios_onboarding_estado
  ON usuarios(onboarding_estado)
  WHERE onboarding_estado IN ('requiere_revision', 'rechazo_consentimiento');
