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
-- Review fixes applied (adversarial review 2026-06-23):
--   Fix 1: REVOKE EXECUTE FROM PUBLIC on provisionar_cliente_atomico
--   Fix 3: SET search_path = public, pg_temp on set_trial_fin() (D31 pattern)
--   Fix 4: org_id generated atomically INSIDE the RPC via advisory lock
--
-- Changes in this migration:
--   1. Make trial_inicio / trial_fin nullable (drop NOT NULL + DEFAULT)
--   2. Rewrite set_trial_fin() conditioned on trial_inicio IS NOT NULL + pin search_path
--   3. Recreate trigger as BEFORE INSERT OR UPDATE OF trial_inicio
--   4. Create provisionar_cliente_atomico() RPC — org_id generated atomically via
--      pg_advisory_xact_lock; returns JSONB {org_id, usuario_id}
--   5. REVOKE EXECUTE FROM PUBLIC (close PostgREST bypass), then GRANT to service_role
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
-- 2. Rewrite set_trial_fin() — conditioned on trial_inicio IS NOT NULL + pin
--    search_path (Fix 3, D31: prevent search-path hijacking on all SECURITY
--    DEFINER functions, consistent with migr. 058).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_trial_fin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn_set_trial_fin$
BEGIN
  IF NEW.trial_inicio IS NOT NULL THEN
    NEW.trial_fin := NEW.trial_inicio + INTERVAL '30 days';
  ELSE
    NEW.trial_fin := NULL;
  END IF;
  RETURN NEW;
END;
$fn_set_trial_fin$;

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
--
--    Fix 4: org_id is now generated INSIDE the RPC, not passed by the caller.
--    Uses pg_advisory_xact_lock(hashtext('provisionar_cliente')) to serialize
--    concurrent calls within the same Postgres transaction, eliminating the TOCTOU
--    race that existed when the TS side pre-computed the id before the INSERT.
--
--    The function:
--      a) acquires an advisory transaction-level lock (released automatically on commit)
--      b) computes next org_id from MAX(org_id) with regex parse
--      c) inserts org + admin + consent atomically
--      d) returns JSONB: { org_id TEXT, usuario_id UUID }
--
--    Callers (TS wrapper provisionarClienteAtomico) no longer pass p_org_id.
--
--    Verified column names (T-01):
--      user_consents: texto_mostrado, aceptado
--      usuarios: status='activo', rol='admin_org', consentimiento_datos=true
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION provisionar_cliente_atomico(
  p_nombre_org   TEXT,
  p_tipo         tipo_org,            -- 'individual' | 'empresa'
  p_pais         TEXT,
  p_fincas       INTEGER,
  p_usuarios     INTEGER,
  p_phone        TEXT,
  p_nombre_admin TEXT,
  p_consent_texto TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp    -- D31: pin search_path, prevent hijacking
AS $fn_provisionar$
DECLARE
  v_org_id    TEXT;
  v_uid       UUID;
  v_max_id    TEXT;
  v_num       INTEGER;
BEGIN
  -- Acquire advisory transaction-level lock (auto-released on commit/rollback).
  -- Key: hashtext of the function name, scoped to prevent conflicts with other locks.
  -- This serializes concurrent provisionings without blocking other workloads.
  PERFORM pg_advisory_xact_lock(hashtext('provisionar_cliente_atomico'));

  -- Compute next org_id from the current maximum, numeric-aware.
  -- NOTE: filter avoids a regex end-anchor ('$') on purpose. The supabase CLI
  -- migration splitter toggles dollar-quote state on every '$' char, so a lone
  -- '$' inside the function body corrupts statement splitting (merges this
  -- function with the trailing REVOKE/GRANT → SQLSTATE 42601). The LIKE +
  -- "no non-digit after ORG" check is semantically identical to ^ORG\d+$.
  SELECT org_id INTO v_max_id
  FROM organizaciones
  WHERE org_id LIKE 'ORG%'
    AND length(org_id) > 3
    AND substring(org_id FROM 4) !~ '[^0-9]'
  ORDER BY length(org_id) DESC, org_id DESC
  LIMIT 1;

  IF v_max_id IS NULL THEN
    v_org_id := 'ORG001';
  ELSE
    v_num    := substring(v_max_id FROM 4)::INTEGER + 1;
    v_org_id := 'ORG' || lpad(v_num::TEXT, 3, '0');
  END IF;

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
    v_org_id,
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
    v_org_id,
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

  RETURN jsonb_build_object('org_id', v_org_id, 'usuario_id', v_uid);
END;
$fn_provisionar$;

-- NOTE: the REVOKE/GRANT permission hardening for provisionar_cliente_atomico
-- lives in migration 20260624000065. It was moved out of this file because the
-- supabase CLI migration splitter merges this CREATE FUNCTION with trailing
-- statements in the same file (SQLSTATE 42601: "multiple commands in a prepared
-- statement"). Keeping the function as the last statement here avoids that.
