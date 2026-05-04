-- =============================================================================
-- Wasagro — Auditoría y optimización de schema
-- Archivo: 20260101000033_db-audit-optimizations.sql
-- Descripción: Limpieza de índices redundantes, FK faltante, updated_at
--              y función de cleanup de registros expirados.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ELIMINAR ÍNDICE DUPLICADO EN sesiones_activas
--    idx_sesiones_expires (migración 03) e idx_sesiones_expired (migración 06)
--    son idénticos: ON sesiones_activas(expires_at) WHERE status = 'active'
--    PostgreSQL los mantiene ambos — doble overhead en cada write de sesión.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_sesiones_expired;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ELIMINAR ÍNDICES DE BAJA SELECTIVIDAD EN eventos_campo
--
--    idx_eventos_finca    — supercedido por idx_eventos_finca_fecha y
--                           idx_eventos_finca_created. PG prefiere composites.
--    idx_eventos_tipo     — tipo_evento tiene 8 valores posibles. Con una
--                           distribución típica (>20% por valor), PG hace
--                           seq scan de todas formas. Overhead de escritura sin
--                           beneficio real.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_eventos_finca;
DROP INDEX IF EXISTS idx_eventos_tipo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AGREGAR ÍNDICES COMPUESTOS DE ALTO VALOR
--
--    (a) Consulta de analítica más frecuente: "eventos de tipo plaga en finca X
--        durante este mes" → finca_id + tipo_evento + fecha_evento
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_eventos_finca_tipo_fecha
    ON eventos_campo(finca_id, tipo_evento, fecha_evento DESC);

--    (b) Cola de revisión: "eventos requires_review en finca X"
--        Partial index — solo indexa la minoría de filas que necesitan revisión.

CREATE INDEX IF NOT EXISTS idx_eventos_requiere_revision
    ON eventos_campo(finca_id, created_at DESC)
    WHERE status = 'requires_review';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FK + updated_at EN plan_de_cuentas (solo si la tabla existe)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_de_cuentas') THEN
        -- FK faltante
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_plan_cuentas_org'
        ) THEN
            ALTER TABLE plan_de_cuentas
                ADD CONSTRAINT fk_plan_cuentas_org
                FOREIGN KEY (org_id) REFERENCES organizaciones(org_id);
        END IF;

        -- updated_at
        ALTER TABLE plan_de_cuentas
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

        -- Trigger
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE trigger_name = 'trg_plan_cuentas_updated_at'
        ) THEN
            CREATE TRIGGER trg_plan_cuentas_updated_at
                BEFORE UPDATE ON plan_de_cuentas
                FOR EACH ROW
                EXECUTE FUNCTION wasagro_set_updated_at();
        END IF;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ÍNDICE FALTANTE EN mensajes_entrada.evento_id (solo si la tabla existe)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mensajes_entrada') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mensajes_evento_id') THEN
            CREATE INDEX idx_mensajes_evento_id
                ON mensajes_entrada(evento_id)
                WHERE evento_id IS NOT NULL;
        END IF;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. FUNCIÓN GENÉRICA updated_at (reutilizable en toda la DB)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION wasagro_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. FUNCIÓN DE CLEANUP PARA REGISTROS EXPIRADOS
--    Sin limpieza, otp_codes y sesiones_activas expiradas acumulan sin límite.
--    Invocar manualmente o programar con pg_cron:
--    SELECT cron.schedule('cleanup-expired', '0 3 * * *', 'SELECT wasagro_cleanup_expired()');
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION wasagro_cleanup_expired()
RETURNS TABLE(otps_eliminados INT, sesiones_expiradas INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_otps   INT;
    v_sesiones INT;
BEGIN
    -- OTPs usados o expirados hace más de 1 día
    DELETE FROM otp_codes
    WHERE used = true OR expires_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS v_otps = ROW_COUNT;

    -- Sesiones activas cuyo TTL venció
    UPDATE sesiones_activas
    SET status = 'expired'
    WHERE status IN ('active', 'processing_intentions', 'pending_confirmation',
                     'pending_location_confirm', 'pending_excel_confirm')
      AND expires_at < NOW();
    GET DIAGNOSTICS v_sesiones = ROW_COUNT;

    RETURN QUERY SELECT v_otps, v_sesiones;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. org_id EN sdr_prospectos (deuda de multi-tenancy)
--    Nullable ahora — backfill a ORG001 para datos existentes.
--    En H1: añadir NOT NULL constraint después del backfill completo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sdr_prospectos
    ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizaciones(org_id);

UPDATE sdr_prospectos SET org_id = 'ORG001' WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sdr_prospectos_org
    ON sdr_prospectos(org_id, status)
    WHERE org_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA TÉCNICA — deuda para H1 (no se toca en esta migración):
--
-- (a) usuarios.consentimiento_datos BOOLEAN vs tabla user_consents:
--     Dos fuentes de verdad sin trigger de sync. La tabla user_consents es el
--     SSOT legal (P6). En H1: deprecar la BOOLEAN y leer siempre desde
--     user_consents con SELECT ... ORDER BY created_at DESC LIMIT 1.
--
-- (b) inventario_insumos.producto como TEXT libre:
--     "Mancozeb" y "mancozeb" crean filas separadas. En H1 añadir tabla
--     productos_catalogo con nombre_canonico y FK desde inventario_insumos.
--
-- (c) pg_cron para cleanup automático:
--     SELECT cron.schedule('wasagro-cleanup', '0 3 * * *',
--       'SELECT wasagro_cleanup_expired()');
--     Requiere extensión pg_cron habilitada en Supabase (Dashboard → Database → Extensions).
-- ─────────────────────────────────────────────────────────────────────────────
