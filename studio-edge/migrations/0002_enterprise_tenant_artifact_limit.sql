-- Apply only to the new isolated MUSITU Intelligence D1 database after 0001.
-- Persistent per-tenant artifact row cap; enforced by SQLite for all Worker
-- isolates and concurrent writers sharing the same D1 database.
-- AFTER INSERT permits overwriting an existing artifact via UPSERT at capacity.
CREATE TRIGGER enterprise_tenant_artifact_limit
AFTER INSERT ON tenant_artifacts
WHEN (SELECT COUNT(*) FROM tenant_artifacts WHERE tenant_id = NEW.tenant_id) > 50
BEGIN
  SELECT RAISE(ABORT, 'tenant_artifact_limit_exceeded');
END;
