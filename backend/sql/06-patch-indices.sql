-- =============================================================================
-- Wasagro H0 — Parche: Índices y vistas NSM
-- Archivo: backend/sql/06-patch-indices.sql
-- Descripción: Índices adicionales para queries frecuentes del pipeline +
--              vistas para la Métrica Norte (eventos completos/semana/finca).
-- Prerequisito: 01-schema-core.sql, 04-patch-mensajes-entrada.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Índice compuesto para NSM: eventos completos por finca por semana
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_nsm_eventos ON eventos_campo(finca_id, created_at)
    WHERE status = 'complete';

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices adicionales para queries frecuentes del pipeline
-- ─────────────────────────────────────────────────────────────────────────────

-- Lookup de lotes activos por finca (inyección en system prompt de extracción)
CREATE INDEX idx_lotes_finca_activos ON lotes(finca_id) WHERE activo = true;

-- Eventos por finca en última semana (flujo-04, reporte semanal)
CREATE INDEX idx_eventos_finca_semana ON eventos_campo(finca_id, created_at DESC)
    WHERE created_at > NOW() - INTERVAL '7 days';

-- Sesiones expiradas para cleanup (GC periódico)
CREATE INDEX idx_sesiones_expired ON sesiones_activas(expires_at)
    WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista: v_nsm — Métrica Norte por finca (semana actual)
-- Métrica Norte: eventos de campo completos por semana por finca activa
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_nsm AS
SELECT
    f.finca_id,
    f.nombre                          AS finca_nombre,
    DATE_TRUNC('week', e.created_at)  AS semana,
    COUNT(*)                          AS eventos_completos,
    COUNT(DISTINCT e.tipo_evento)     AS tipos_distintos,
    COUNT(DISTINCT e.lote_id)         AS lotes_activos,
    AVG(e.confidence_score)           AS confidence_promedio
FROM eventos_campo e
JOIN fincas f ON f.finca_id = e.finca_id
WHERE e.status = 'complete'
GROUP BY f.finca_id, f.nombre, DATE_TRUNC('week', e.created_at)
ORDER BY semana DESC, eventos_completos DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista: v_nsm_global — Métrica Norte agregada (todas las fincas)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_nsm_global AS
SELECT
    DATE_TRUNC('week', e.created_at)                                             AS semana,
    COUNT(DISTINCT e.finca_id)                                                   AS fincas_activas,
    COUNT(*)                                                                     AS total_eventos_completos,
    ROUND(COUNT(*)::NUMERIC / NULLIF(COUNT(DISTINCT e.finca_id), 0), 1)         AS eventos_por_finca,
    COUNT(*) FILTER (WHERE e.tipo_evento = 'nota_libre')                         AS total_notas_libres,
    ROUND(
        COUNT(*) FILTER (WHERE e.tipo_evento = 'nota_libre')::NUMERIC * 100 /
        NULLIF(COUNT(*), 0), 1
    )                                                                            AS pct_notas_libres,
    AVG(e.confidence_score)                                                      AS confidence_promedio_global
FROM eventos_campo e
WHERE e.status IN ('complete', 'requires_review')
GROUP BY DATE_TRUNC('week', e.created_at)
ORDER BY semana DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista: v_pipeline_health — Salud del pipeline (últimas 24h)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_pipeline_health AS
SELECT
    COUNT(*)                                           AS mensajes_24h,
    COUNT(*) FILTER (WHERE status = 'processed')       AS procesados,
    COUNT(*) FILTER (WHERE status = 'error')           AS errores,
    COUNT(*) FILTER (WHERE status = 'received')        AS pendientes,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'processed')::NUMERIC * 100 /
        NULLIF(COUNT(*), 0), 1
    )                                                  AS tasa_exito_pct
FROM mensajes_entrada
WHERE created_at > NOW() - INTERVAL '24 hours';
