-- T1.7: Idempotent org-default seed for umbrales_alerta (H4 — regression-safe cutover).
-- Seeds sigatoka_negra org-default rows from UMBRALES_SEVERIDAD_DEFAULT for every
-- org that has at least one banano finca. Without this, fincas with config={}
-- (the majority) would have ZERO rows post-cutover and the 3 currently-firing
-- Sigatoka thresholds (J>10, I>5, M<9) would silently stop firing (R3).
-- ee2Leve is seeded enabled=false (no agronomic basis, H5, P7).
-- ON CONFLICT DO NOTHING makes all DML idempotent (safe to re-run).
INSERT INTO umbrales_alerta (org_id, finca_id, pest_type, campo, operador, valor, enabled)
SELECT DISTINCT
  f.org_id,
  NULL::text       AS finca_id,
  'sigatoka_negra' AS pest_type,
  v.campo,
  v.operador,
  v.valor,
  v.enabled
FROM fincas f
JOIN (VALUES
  ('ee3a6Severo',        'gt',  10::numeric, true),
  ('ee2Avanzado',        'gt',   5::numeric, true),
  ('hojasFuncionalesMin','lt',   9::numeric, true),
  ('ee2Leve',            'gt',  30::numeric, false)
) AS v(campo, operador, valor, enabled) ON true
WHERE f.cultivo_principal ILIKE 'banano'
ON CONFLICT (org_id, finca_scope, pest_type, campo) DO NOTHING;

-- Per-finca backfill: for fincas that already have sigatoka_umbrales in fincas.config,
-- insert per-finca override rows preserving their custom values.
-- Casts JSONB numeric fields to NUMERIC; skips rows where the field is null or non-numeric.
INSERT INTO umbrales_alerta (org_id, finca_id, pest_type, campo, operador, valor, enabled)
SELECT
  f.org_id,
  f.finca_id,
  'sigatoka_negra' AS pest_type,
  v.campo,
  v.operador,
  (f.config -> 'sigatoka_umbrales' ->> v.campo)::numeric AS valor,
  v.enabled
FROM fincas f
JOIN (VALUES
  ('ee3a6Severo',        'gt',  true),
  ('ee2Avanzado',        'gt',  true),
  ('hojasFuncionalesMin','lt',  true),
  ('ee2Leve',            'gt',  false)
) AS v(campo, operador, enabled) ON true
WHERE f.cultivo_principal ILIKE 'banano'
  AND f.config -> 'sigatoka_umbrales' IS NOT NULL
  AND (f.config -> 'sigatoka_umbrales' ->> v.campo) IS NOT NULL
  AND (f.config -> 'sigatoka_umbrales' ->> v.campo) ~ '^[0-9]+(\.[0-9]+)?$'
ON CONFLICT (org_id, finca_scope, pest_type, campo) DO NOTHING;
