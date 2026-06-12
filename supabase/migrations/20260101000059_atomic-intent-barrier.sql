-- =============================================================================
-- Wasagro — Barrera de intenciones atómica (fix de condición de carrera)
-- =============================================================================
-- Problema: marcarIntencionCompletada/marcarIntencionFallida hacían un
-- read-modify-write NO atómico sobre sesiones_activas.contexto_parcial desde
-- TypeScript. Con varios workers (localConcurrency=3) terminando intenciones
-- de un mismo mensaje a la vez, el segundo UPDATE pisaba al primero (lost
-- update) → el flag "todas_completas" no disparaba y el usuario no recibía el
-- resumen consolidado, o lo recibía incompleto.
--
-- Solución: una sola función que toma el lock de fila (SELECT ... FOR UPDATE),
-- muta el arreglo JSONB de intenciones, recalcula contadores y devuelve el
-- estado — todo atómico. Postgres serializa los workers sobre la misma fila.
-- =============================================================================

CREATE OR REPLACE FUNCTION marcar_intencion_estado(
  p_session_id      TEXT,
  p_job_id          TEXT,
  p_status          TEXT,             -- 'completed' | 'failed'
  p_evento_extraido JSONB,            -- evento extraído, o {"error": "..."} si falló
  p_evento_id       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctx           JSONB;
  v_intenciones   JSONB;
  v_actualizadas  JSONB;
  v_transaccion   TEXT;
  v_total         INT;
  v_completadas   INT;
  v_fallidas      INT;
  v_todas         BOOLEAN;
  v_extracted     JSONB;
  v_new_status    TEXT;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'p_status inválido: % (esperado completed|failed)', p_status;
  END IF;

  -- Lock de fila: serializa cualquier otro worker que toque esta sesión.
  SELECT contexto_parcial INTO v_ctx
  FROM sesiones_activas
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF v_ctx IS NULL THEN
    RAISE EXCEPTION 'sesion no encontrada o sin contexto_parcial: %', p_session_id;
  END IF;

  v_intenciones := COALESCE(v_ctx->'intenciones_pendientes', '[]'::jsonb);
  v_transaccion := COALESCE(v_ctx->>'transaccion_original', '');

  -- Marca SOLO la intención de este job_id; el resto queda intacto.
  -- COALESCE: jsonb_agg sobre un arreglo vacío devuelve NULL.
  SELECT COALESCE(jsonb_agg(
           CASE WHEN elem->>'job_id' = p_job_id
                THEN elem || jsonb_build_object(
                       'status', p_status,
                       'evento_extraido', p_evento_extraido,
                       'evento_id', CASE WHEN p_evento_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_evento_id) END
                     )
                ELSE elem
           END
         ), '[]'::jsonb)
  INTO v_actualizadas
  FROM jsonb_array_elements(v_intenciones) elem;

  v_total := jsonb_array_length(v_actualizadas);
  SELECT count(*) INTO v_completadas FROM jsonb_array_elements(v_actualizadas) e WHERE e->>'status' = 'completed';
  SELECT count(*) INTO v_fallidas   FROM jsonb_array_elements(v_actualizadas) e WHERE e->>'status' = 'failed';

  v_todas := (v_completadas + v_fallidas = v_total) AND v_completadas > 0;

  -- extracted_data = eventos completados que NO son aclaraciones.
  SELECT COALESCE(jsonb_agg(e->'evento_extraido'), '[]'::jsonb)
  INTO v_extracted
  FROM jsonb_array_elements(v_actualizadas) e
  WHERE e->>'status' = 'completed'
    AND COALESCE((e->'evento_extraido'->>'_es_clarificacion')::boolean, false) = false;

  v_new_status := CASE WHEN v_todas THEN 'completed' ELSE 'processing_intentions' END;

  UPDATE sesiones_activas
  SET contexto_parcial = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(v_ctx, '{intenciones_pendientes}', v_actualizadas, true),
            '{completadas}', to_jsonb(v_completadas), true),
          '{fallidas}', to_jsonb(v_fallidas), true),
        '{extracted_data}', v_extracted, true),
      status = v_new_status
  WHERE session_id = p_session_id;

  RETURN jsonb_build_object(
    'todas_completas', v_todas,
    'intenciones', v_actualizadas,
    'transaccion_original', v_transaccion
  );
END;
$$;

-- Solo el backend (service_role) debe ejecutar esta mutación de estado de sesión.
REVOKE ALL ON FUNCTION marcar_intencion_estado(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION marcar_intencion_estado(TEXT, TEXT, TEXT, JSONB, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION marcar_intencion_estado(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
