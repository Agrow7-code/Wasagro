-- Migration: add alerta_plaga_entregada_at to eventos_campo
-- Purpose: idempotency guard for entregarAlertaPlaga — prevents duplicate sends on
-- procesar-intencion retries (retryLimit=3). Record is set BEFORE enviarTexto so that
-- a crash-after-mark is safe (one missed send) vs. crash-after-send (duplicate).
-- Design: configurable-alert-thresholds §6.2 / remediation item #1.

ALTER TABLE eventos_campo
  ADD COLUMN IF NOT EXISTS alerta_plaga_entregada_at TIMESTAMPTZ;
