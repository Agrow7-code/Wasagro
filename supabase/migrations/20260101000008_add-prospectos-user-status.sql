-- =============================================================================
-- Wasagro — Schema: Prospectos + status de usuario
-- Archivo: 08-add-prospectos-user-status.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: prospectos
-- Leads captados por el flujo de números no registrados (sp-00-prospecto)
-- No tiene RLS porque no son datos de finca — son leads de ventas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE prospectos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone               TEXT NOT NULL,
    tipo_contacto       TEXT NOT NULL CHECK (tipo_contacto IN ('trabajador', 'decision_maker', 'otro')),
    nombre              TEXT,
    finca_nombre        TEXT,
    cultivo_principal   TEXT,
    pais                TEXT,
    tamanio_aproximado  TEXT,
    interes_demo        BOOLEAN NOT NULL DEFAULT false,
    creado_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospectos_phone ON prospectos(phone);
CREATE INDEX idx_prospectos_tipo  ON prospectos(tipo_contacto);

-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNA: usuarios.status
-- Soporta el flujo pendiente_aprobacion para agricultores sin jefe aprobado
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'activo'
    CHECK (status IN ('activo', 'pendiente_aprobacion', 'inactivo'));

-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNA: usuarios.updated_at
-- Requerido por updateUsuario()
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
