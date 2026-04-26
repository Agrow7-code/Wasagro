-- =============================================================================
-- Wasagro H0 — Schema Core
-- Archivo: backend/sql/01-schema-core.sql
-- Descripción: Tablas principales del sistema. Ejecutar PRIMERO.
-- =============================================================================

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE tipo_evento AS ENUM (
    'labor',
    'insumo',
    'plaga',
    'clima',
    'cosecha',
    'gasto',
    'observacion',
    'nota_libre'
);

CREATE TYPE status_evento AS ENUM (
    'draft',
    'complete',
    'requires_review'
);

CREATE TYPE rol_usuario AS ENUM (
    'agricultor',
    'administrador',
    'gerente',
    'propietario',
    'tecnico'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: fincas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE fincas (
    finca_id          TEXT PRIMARY KEY,                              -- F001, F002, ...
    nombre            TEXT NOT NULL,
    ubicacion         TEXT,                                          -- Departamento/provincia
    pais              TEXT DEFAULT 'EC',                             -- EC, GT
    cultivo_principal TEXT,                                          -- cacao, banano
    coordenadas       geography(POINT, 4326),                        -- Centroide de la finca
    poligono          geography(POLYGON, 4326),                      -- Perímetro EUDR (6 decimales)
    hectareas_total   NUMERIC(8,2),
    activa            BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: usuarios
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE usuarios (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone                TEXT NOT NULL UNIQUE,                       -- 593XXXXXXXXX (sin +)
    nombre               TEXT,
    rol                  rol_usuario DEFAULT 'agricultor',
    finca_id             TEXT REFERENCES fincas(finca_id),
    onboarding_completo  BOOLEAN DEFAULT false,
    consentimiento_datos BOOLEAN DEFAULT false,
    idioma               TEXT DEFAULT 'es',
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usuarios_phone ON usuarios(phone);
CREATE INDEX idx_usuarios_finca ON usuarios(finca_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: lotes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE lotes (
    lote_id          TEXT PRIMARY KEY,                               -- F001-L01, F001-L02, ...
    finca_id         TEXT NOT NULL REFERENCES fincas(finca_id),
    nombre_coloquial TEXT NOT NULL,                                  -- "el de arriba", "lote 3"
    cultivo          TEXT,                                           -- Hereda de finca si null
    hectareas        NUMERIC(8,2),
    coordenadas      geography(POINT, 4326),
    poligono         geography(POLYGON, 4326),
    activo           BOOLEAN DEFAULT true,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lotes_finca ON lotes(finca_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA: eventos_campo
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE eventos_campo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finca_id            TEXT NOT NULL REFERENCES fincas(finca_id),
    lote_id             TEXT REFERENCES lotes(lote_id),              -- Nullable: clima/gasto sin lote
    tipo_evento         tipo_evento NOT NULL,
    status              status_evento NOT NULL DEFAULT 'draft',
    datos_evento        JSONB NOT NULL DEFAULT '{}',                 -- Campos específicos por tipo
    descripcion_raw     TEXT NOT NULL,                               -- Input original sin procesar (P5)
    confidence_score    NUMERIC(3,2),                                -- 0.00 - 1.00
    requiere_validacion BOOLEAN DEFAULT false,
    fecha_evento        DATE DEFAULT CURRENT_DATE,                   -- Fecha del evento (puede diferir de created_at)
    created_by          UUID REFERENCES usuarios(id),
    mensaje_id          UUID,                                        -- FK a mensajes_entrada (añadida en 04)
    severidad           TEXT,                                        -- Estructura para H1 alertas (solo columna, no lógica)
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eventos_finca       ON eventos_campo(finca_id);
CREATE INDEX idx_eventos_lote        ON eventos_campo(lote_id);
CREATE INDEX idx_eventos_tipo        ON eventos_campo(tipo_evento);
CREATE INDEX idx_eventos_status      ON eventos_campo(status);
CREATE INDEX idx_eventos_fecha       ON eventos_campo(fecha_evento);
CREATE INDEX idx_eventos_created_at  ON eventos_campo(created_at);
CREATE INDEX idx_eventos_finca_fecha ON eventos_campo(finca_id, fecha_evento);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (Row Level Security) — P5: datos pertenecen a la finca
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fincas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_campo ENABLE ROW LEVEL SECURITY;

-- Política: usuario ve solo datos de su finca
-- auth.uid() es el UUID de Supabase Auth; se vincula via usuarios.id

CREATE POLICY "usuarios_own_finca" ON usuarios
    FOR ALL
    USING (id = auth.uid());

CREATE POLICY "fincas_by_user" ON fincas
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );

CREATE POLICY "lotes_by_finca" ON lotes
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );

CREATE POLICY "eventos_by_finca" ON eventos_campo
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );

-- Nota: el backend usa service_role key, que bypassa RLS en Supabase por defecto.
-- No se necesitan políticas adicionales para el pipeline.
