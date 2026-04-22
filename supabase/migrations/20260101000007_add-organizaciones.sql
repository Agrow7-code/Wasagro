-- =============================================================================
-- Wasagro — Schema: Organizaciones (multi-tenant)
-- Archivo: 07-add-organizaciones.sql
-- Descripción: Agrega la entidad organizaciones como raíz de seguridad
--              y facturación. Soporta B2C (individual) y B2B (empresa).
--              Actualiza roles de usuario, RLS y backfill de datos existentes.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- NUEVOS ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE tipo_org AS ENUM (
    'individual',   -- B2C: agricultor o propietario independiente
    'empresa'       -- B2B: exportadora, banco, fintech, asociacion, cooperativa
);

CREATE TYPE sector_org AS ENUM (
    'exportadora',
    'banco',
    'fintech',
    'asociacion',
    'cooperativa',
    'independiente'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: organizaciones
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE organizaciones (
    org_id      TEXT PRIMARY KEY,                   -- ORG001, ORG002, ...
    nombre      TEXT NOT NULL,
    tipo        tipo_org NOT NULL DEFAULT 'individual',
    sector      sector_org,                          -- relevante solo para tipo='empresa'
    pais        TEXT NOT NULL DEFAULT 'EC',
    plan        TEXT NOT NULL DEFAULT 'free',        -- 'free', 'starter', 'enterprise'
    activa      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizaciones ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENDER rol_usuario CON NUEVOS ROLES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'jefe_finca';  -- supervisa una finca
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'director';    -- supervisa varias fincas
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'analista';    -- lee reportes, sin acción de campo
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'admin_org';   -- administra la organización completa

-- ─────────────────────────────────────────────────────────────────────────────
-- MODIFICAR fincas — agregar org_id
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fincas ADD COLUMN org_id TEXT REFERENCES organizaciones(org_id);
CREATE INDEX idx_fincas_org ON fincas(org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODIFICAR usuarios — agregar org_id y email
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE usuarios ADD COLUMN org_id TEXT REFERENCES organizaciones(org_id);
ALTER TABLE usuarios ADD COLUMN email  TEXT UNIQUE;
CREATE INDEX idx_usuarios_org ON usuarios(org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- DATOS INICIALES — org para finca de prueba existente
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO organizaciones (org_id, nombre, tipo, sector, pais, plan)
VALUES ('ORG001', 'Bananera Puebloviejo', 'individual', 'independiente', 'EC', 'free');

UPDATE fincas   SET org_id = 'ORG001' WHERE finca_id = 'F001';
UPDATE usuarios SET org_id = 'ORG001' WHERE finca_id = 'F001';

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT NULL después del backfill
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fincas   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE usuarios ALTER COLUMN org_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — migrar a límite org_id
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "usuarios_own_finca"  ON usuarios;
DROP POLICY IF EXISTS "fincas_by_user"      ON fincas;
DROP POLICY IF EXISTS "lotes_by_finca"      ON lotes;
DROP POLICY IF EXISTS "eventos_by_finca"    ON eventos_campo;

-- Función auxiliar para evitar recursión en políticas de usuarios
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT org_id FROM usuarios WHERE id = auth.uid() LIMIT 1;
$$;

-- Organizaciones: miembro de la org la ve
CREATE POLICY "org_select" ON organizaciones
    FOR SELECT
    USING (org_id = get_user_org_id());

-- Usuarios: todos los de la misma org se ven entre sí
CREATE POLICY "org_isolation_usuarios" ON usuarios
    FOR ALL
    USING (org_id = get_user_org_id());

-- Fincas: todas las de la org
CREATE POLICY "org_isolation_fincas" ON fincas
    FOR ALL
    USING (org_id = get_user_org_id());

-- Lotes: todos los de fincas de la org
CREATE POLICY "org_isolation_lotes" ON lotes
    FOR ALL
    USING (
        finca_id IN (
            SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
        )
    );

-- Eventos: todos los de fincas de la org
CREATE POLICY "org_isolation_eventos" ON eventos_campo
    FOR ALL
    USING (
        finca_id IN (
            SELECT finca_id FROM fincas WHERE org_id = get_user_org_id()
        )
    );
