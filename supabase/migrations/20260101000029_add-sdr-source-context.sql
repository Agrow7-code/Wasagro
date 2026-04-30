-- Migration to add source_context for CTWA context initialization
ALTER TABLE sdr_prospectos ADD COLUMN source_context TEXT;
