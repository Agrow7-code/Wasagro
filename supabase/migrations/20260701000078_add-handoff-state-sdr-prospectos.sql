-- Migration: add handoff (pause/resume) state to sdr_prospectos
-- Purpose: per-conversation human takeover for the SDR pipeline (founder-crm
-- change, PR1a). Pause state = columns on sdr_prospectos (design Decision 1).
-- Additive, safe DEFAULT 'bot' — existing rows resume as bot, zero backfill.
-- RLS: no change needed — inherits the existing sdr_prospectos_service_access
-- FOR ALL policy (migration 20260101000040), REQ-hand-007.

ALTER TABLE sdr_prospectos
  ADD COLUMN IF NOT EXISTS handoff_status TEXT NOT NULL DEFAULT 'bot'
    CHECK (handoff_status IN ('bot', 'human_paused')),
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT
    CHECK (handoff_reason IN ('manual', 'auto_human_request')),
  ADD COLUMN IF NOT EXISTS handoff_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_last_pinged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sdr_prospectos_handoff_paused
  ON sdr_prospectos (id)
  WHERE handoff_status = 'human_paused';
