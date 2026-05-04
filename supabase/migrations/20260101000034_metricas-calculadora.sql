-- =============================================================================
-- Wasagro — Calculadora y métricas por finca
-- Archivo: 20260101000034_metricas-calculadora.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEFINICIÓN DE FÓRMULAS (metricas_finca)
--
--    formula JSONB — array de bloques evaluados de izquierda a derecha:
--      { tipo: 'campo',    evento_tipo, campo, agregacion }
--      { tipo: 'numero',   valor }
--      { tipo: 'operador', valor: 'add'|'sub'|'mul'|'div' }
--
--    finca_id NULL  → métrica de plantilla (org-level, sugerible a otras fincas)
--    finca_id set   → métrica propia de esa finca
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS metricas_finca (
    metrica_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       TEXT        NOT NULL REFERENCES organizaciones(org_id),
    finca_id     TEXT        REFERENCES fincas(finca_id),
    nombre       TEXT        NOT NULL,
    descripcion  TEXT,
    tipo_evento  TEXT        NOT NULL,
    formula      JSONB       NOT NULL,
    unidad       TEXT,
    es_publica   BOOLEAN     NOT NULL DEFAULT false,
    activa       BOOLEAN     NOT NULL DEFAULT true,
    created_by   UUID        REFERENCES usuarios(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_metricas_finca_id    ON metricas_finca(finca_id) WHERE finca_id IS NOT NULL;
CREATE INDEX idx_metricas_org_publica ON metricas_finca(org_id, es_publica) WHERE es_publica = true;

CREATE TRIGGER trg_metricas_updated_at
    BEFORE UPDATE ON metricas_finca
    FOR EACH ROW EXECUTE FUNCTION wasagro_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UMBRALES POR FINCA (umbrales_metrica)
--
--    Una misma métrica puede tener umbrales distintos en cada finca.
--    valor_max NULL → sin techo (abierto hacia arriba).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS umbrales_metrica (
    umbral_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    metrica_id  UUID        NOT NULL REFERENCES metricas_finca(metrica_id) ON DELETE CASCADE,
    finca_id    TEXT        NOT NULL REFERENCES fincas(finca_id),
    nivel       TEXT        NOT NULL CHECK (nivel IN ('bajo','medio','alto','critico')),
    valor_min   NUMERIC     NOT NULL,
    valor_max   NUMERIC,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (metrica_id, finca_id, nivel)
);

CREATE INDEX idx_umbrales_metrica_finca ON umbrales_metrica(metrica_id, finca_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RESULTADOS CALCULADOS (resultados_metricas)
--
--    Caché de resultados para no recalcular en cada request del dashboard.
--    lote_id NULL → resultado agregado de toda la finca.
--    nivel_actual se actualiza comparando valor contra umbrales_metrica.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS resultados_metricas (
    resultado_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    metrica_id    UUID        NOT NULL REFERENCES metricas_finca(metrica_id) ON DELETE CASCADE,
    finca_id      TEXT        NOT NULL REFERENCES fincas(finca_id),
    lote_id       TEXT        REFERENCES lotes(lote_id),
    fecha_inicio  DATE        NOT NULL,
    fecha_fin     DATE        NOT NULL,
    valor         NUMERIC,
    nivel_actual  TEXT        CHECK (nivel_actual IN ('bajo','medio','alto','critico')),
    calculado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (metrica_id, finca_id, lote_id, fecha_inicio, fecha_fin)
);

CREATE INDEX idx_resultados_finca_fecha
    ON resultados_metricas(finca_id, fecha_fin DESC);

CREATE INDEX idx_resultados_metrica_lote
    ON resultados_metricas(metrica_id, lote_id, fecha_fin DESC)
    WHERE lote_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — acceso scoped por org_id / finca_id
--    El backend usa service_role (bypassa RLS). Las políticas protegen acceso
--    directo desde clientes (dashboard, anon key).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE metricas_finca      ENABLE ROW LEVEL SECURITY;
ALTER TABLE umbrales_metrica    ENABLE ROW LEVEL SECURITY;
ALTER TABLE resultados_metricas ENABLE ROW LEVEL SECURITY;

-- metricas_finca: visible si la métrica es de la finca del usuario
-- o es plantilla pública de su org
CREATE POLICY metricas_finca_select ON metricas_finca
    FOR SELECT USING (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
        OR (
            es_publica = true
            AND org_id IN (
                SELECT f.org_id FROM fincas f
                JOIN usuarios u ON u.finca_id = f.finca_id
                WHERE u.id = auth.uid()
            )
        )
    );

CREATE POLICY metricas_finca_insert ON metricas_finca
    FOR INSERT WITH CHECK (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );

CREATE POLICY metricas_finca_update ON metricas_finca
    FOR UPDATE USING (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );

-- umbrales_metrica: acceso por finca_id del usuario
CREATE POLICY umbrales_select ON umbrales_metrica
    FOR SELECT USING (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );

CREATE POLICY umbrales_insert ON umbrales_metrica
    FOR INSERT WITH CHECK (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );

CREATE POLICY umbrales_update ON umbrales_metrica
    FOR UPDATE USING (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );

-- resultados_metricas: lectura por finca_id del usuario
CREATE POLICY resultados_select ON resultados_metricas
    FOR SELECT USING (
        finca_id IN (
            SELECT f.finca_id FROM fincas f
            JOIN usuarios u ON u.finca_id = f.finca_id
            WHERE u.id = auth.uid()
        )
    );
