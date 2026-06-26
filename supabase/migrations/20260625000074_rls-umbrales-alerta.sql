-- T1.8: Revoke public access and grant service_role full access on the two
-- new tables. Backend authorizes all access via requireFincaAccessAsync /
-- requireOrgAccessAsync before any read or write (design §2.5, D31).
-- Splitting REVOKE and GRANT into adjacent statements is OK in this file
-- (no CREATE FUNCTION between them), but we keep one concern per file for clarity.
REVOKE ALL ON umbrales_alerta FROM PUBLIC;
REVOKE ALL ON decision_alerta  FROM PUBLIC;
GRANT ALL ON umbrales_alerta TO service_role;
GRANT ALL ON decision_alerta  TO service_role;
