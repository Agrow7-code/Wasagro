-- Migration: Add sdr_node state column to sdr_prospectos
ALTER TABLE "public"."sdr_prospectos"
ADD COLUMN "sdr_node" TEXT NOT NULL DEFAULT 'triage';

-- Optional: constraint on valid nodes
ALTER TABLE "public"."sdr_prospectos"
ADD CONSTRAINT check_sdr_node_values 
CHECK (sdr_node IN ('triage', 'discovery', 'pitch', 'close'));

-- Also, add index for faster querying by node
CREATE INDEX IF NOT EXISTS idx_sdr_prospectos_sdr_node ON "public"."sdr_prospectos"("sdr_node");