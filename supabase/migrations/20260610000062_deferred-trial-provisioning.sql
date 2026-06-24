-- =============================================================================
-- Wasagro — Deferred trial + provisionar_cliente_atomico RPC
-- Migration: 20260610000062_deferred-trial-provisioning.sql
-- Change:    client-provisioning (D33)
--
-- T-01 schema verification results (confirmed against migrations 001/002/007/008):
--   user_consents columns: texto_mostrado (TEXT NOT NULL), aceptado (BOOLEAN NOT NULL)
--   usuarios.status values: 'activo' | 'pendiente_aprobacion' | 'inactivo'
--   rol_usuario enum includes 'admin_org' (added in migr. 007)
--   tipo_org enum: 'individual' | 'empresa' only (no 'cooperativa' — that is sector_org)
--   organizaciones: fincas_contratadas, usuarios_contratados added in migr. 056
--   is_test_org: added in migr. 052
--
-- Changes in this migration:
--   1. Make trial_inicio / trial_fin nullable (drop NOT NULL + DEFAULT)
--   2. Rewrite set_trial_fin() conditioned on trial_inicio IS NOT NULL
--   3. Recreate trigger as BEFORE INSERT OR UPDATE OF trial_inicio
--   4. Create provisionar_cliente_atomico() RPC (SECURITY DEFINER, search_path pineado)
--   5. GRANT EXECUTE to service_role
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Make trial columns nullable (deferred-trial semantic)
--    Existing orgs (ORG001, any real client) already have NOT NULL values from
--    migr. 049 backfill — they are untouched. New provisioned orgs get NULL.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizaciones ALTER COLUMN trial_inicio DROP NOT NULL;
ALTER TABLE organizaciones ALTER COLUMN trial_inicio DROP DEFAULT;
ALTER TABLE organizaciones ALTER COLUMN trial_fin    DROP NOT NULL;
ALTER TABLE organizaciones ALTER COLUMN trial_fin    DROP DEFAULT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rewrite set_trial_fin() — only compute trial_fin when trial_inicio is set.
--    If trial_inicio IS NULL (deferred), trial_fin stays NULL.
--    The +30d is computed exclusively by the DB trigger — TS never calculates it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_trial_fin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trial_inicio IS NOT NULL THEN
    NEW.trial_fin := NEW.trial_inicio + INTERVAL '30 days';
  ELSE
    NEW.trial_fin := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recreate trigger: BEFORE INSERT OR UPDATE OF trial_inicio
--    (was BEFORE INSERT only — must also fire on UPDATE to recalculate trial_fin
--    when OnboardingHandler sets trial_inicio = NOW())
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_set_trial_fin ON organizaciones;

CREATE TRIGGER trg_set_trial_fin
  BEFORE INSERT OR UPDATE OF trial_inicio ON organizaciones
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_fin();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: provisionar_cliente_atomico
--    Creates org + admin user + consent in a single transaction.
--    Called by the TS wrapper provisionarClienteAtomico() in supabaseQueries.ts.
--    Returns the UUID of the created admin user.
--
--    Verified column names (T-01):
--      user_consents: texto_mostrado, aceptado
--      usuarios: status='activo', rol='admin_org', consentimiento_datos=true
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION provisionar_cliente_atomico(
  p_org_id       TEXT,
  p_nombre_org   TEXT,
  p_tipo         tipo_org,            -- 'individual' | 'empresa'
  p_pais         TEXT,
  p_fincas       INTEGER,
  p_usuarios     INTEGER,
  p_phone        TEXT,
  p_nombre_admin TEXT,
  p_consent_texto TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public             -- D31: pin search_path, prevent hijacking
AS $$
DECLARE
  v_uid UUID;
BEGIN
  -- Step 1: Create organization with deferred trial (trial_inicio = NULL).
  --         trial_fin will also be NULL (trigger set_trial_fin runs, sees NULL, keeps NULL).
  INSERT INTO organizaciones (
    org_id,
    nombre,
    tipo,
    pais,
    plan,
    activa,
    trial_inicio,
    trial_fin,
    fincas_contratadas,
    usuarios_contratados,
    is_test_org
  ) VALUES (
    p_org_id,
    p_nombre_org,
    p_tipo,
    p_pais,
    'trial',
    true,
    NULL,     -- trial deferred: starts at onboarding completion
    NULL,     -- computed by trigger when trial_inicio is set
    p_fincas,
    p_usuarios,
    false     -- real clients are never test orgs
  );

  -- Step 2: Create the admin user.
  --         status='activo' (verified: migr. 008 CHECK constraint uses 'activo').
  INSERT INTO usuarios (
    phone,
    nombre,
    rol,
    org_id,
    onboarding_completo,
    consentimiento_datos,
    status
  ) VALUES (
    p_phone,
    p_nombre_admin,
    'admin_org',
    p_org_id,
    false,
    true,
    'activo'
  )
  RETURNING id INTO v_uid;

  -- Step 3: Record consent (P6: documented before field data is captured).
  --         Verified column names: texto_mostrado, aceptado (migr. 002).
  --         This row is immutable — no UPDATE/DELETE (audit trail).
  INSERT INTO user_consents (
    user_id,
    phone,
    tipo,
    texto_mostrado,
    aceptado
  ) VALUES (
    v_uid,
    p_phone,
    'datos',
    p_consent_texto,
    true
  );

  RETURN v_uid;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Grant execute to service_role (backend pipeline bypasses RLS via service key)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION provisionar_cliente_atomico(
  TEXT, TEXT, tipo_org, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT
) TO service_role;
