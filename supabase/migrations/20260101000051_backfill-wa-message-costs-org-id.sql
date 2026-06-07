-- 051: Backfill wa_message_costs.org_id from fincas table
-- Existing rows have org_id = NULL because CostTrackedSender was added after
-- the table was already in use. This one-time UPDATE resolves org attribution
-- for all historical cost records.

UPDATE wa_message_costs c
SET org_id = f.org_id
FROM fincas f
WHERE c.finca_id = f.finca_id
  AND c.org_id IS NULL;
