-- =============================================================================
-- Wasagro Analítica — Vista de Eventos Aplanada
-- Permite cálculos deterministas de severidad y costos sin procesar JSON en FE.
-- =============================================================================

CREATE OR REPLACE VIEW v_eventos_analisis AS
SELECT 
    e.id,
    e.finca_id,
    e.lote_id,
    l.nombre_coloquial as lote_nombre,
    e.tipo_evento,
    e.status,
    e.fecha_evento,
    e.descripcion_raw,
    
    -- Campos de Plagas
    (e.datos_evento->>'individuos_encontrados')::NUMERIC as plaga_individuos,
    (e.datos_evento->>'tamano_muestra')::NUMERIC as plaga_muestra,
    e.datos_evento->>'organo_afectado' as plaga_organo,
    e.datos_evento->>'nombre_comun' as plaga_nombre,
    
    -- Cálculo de Severidad (0 si no hay datos)
    CASE 
        WHEN (e.datos_evento->>'tamano_muestra')::NUMERIC > 0 
        THEN ROUND(((e.datos_evento->>'individuos_encontrados')::NUMERIC / (e.datos_evento->>'tamano_muestra')::NUMERIC) * 100, 2)
        ELSE 0 
    END as plaga_severidad_pct,

    -- Campos de Costos
    (e.datos_evento->>'monto')::NUMERIC as costo_monto,
    e.datos_evento->>'categoria' as costo_categoria,
    
    e.created_at
FROM eventos_campo e
LEFT JOIN lotes l ON e.lote_id = l.lote_id;
