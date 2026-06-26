-- T1.6: Extend wasagro_cleanup_expired() to include pending_sigatoka_aclaracion
-- and pending_alert_config in the expired-session GC sweep.
-- Without this update, sessions in those statuses accumulate forever (design §2.6).
-- Per the Supabase CLI splitter rule: CREATE OR REPLACE FUNCTION is the LAST
-- (and only) statement in this file, using explicit $function$ dollar-quote tags.
CREATE OR REPLACE FUNCTION wasagro_cleanup_expired()
RETURNS TABLE(otps_eliminados INT, sesiones_expiradas INT)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_otps    INT;
    v_sesiones INT;
BEGIN
    -- OTPs usados o expirados hace más de 1 día
    DELETE FROM otp_codes
    WHERE used = true OR expires_at < NOW() - INTERVAL '1 day';
    GET DIAGNOSTICS v_otps = ROW_COUNT;

    -- Sesiones activas cuyo TTL venció (incluye los estados pending_* de Sigatoka
    -- y alert_config para que no se acumulen indefinidamente).
    UPDATE sesiones_activas
    SET status = 'expired'
    WHERE status IN (
        'active',
        'processing_intentions',
        'pending_confirmation',
        'pending_location_confirm',
        'pending_excel_confirm',
        'pending_sigatoka_aclaracion',
        'pending_alert_config'
      )
      AND expires_at < NOW();
    GET DIAGNOSTICS v_sesiones = ROW_COUNT;

    RETURN QUERY SELECT v_otps, v_sesiones;
END;
$function$
