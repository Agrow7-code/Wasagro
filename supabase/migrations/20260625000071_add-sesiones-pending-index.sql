-- T1.5: Partial index on sesiones_activas for fast pending_* session lookups.
-- Used by outreach step to check if a decision-maker has an in-flight session
-- before opening a new pending_alert_config session (design §2.6, §4.4).
CREATE INDEX IF NOT EXISTS idx_sesiones_pending
  ON sesiones_activas (phone)
  WHERE status IN ('pending_sigatoka_aclaracion', 'pending_alert_config');
