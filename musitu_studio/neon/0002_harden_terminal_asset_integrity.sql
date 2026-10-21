-- MUSITU Studio V0.3: additive security migration 2, on isolated Neon staging only.
-- No production cutover, credentials, access policy or CPU/GPU settings modified.
-- All four statements must execute in one transaction. PostgreSQL 17+.
-- @statement
CREATE OR REPLACE FUNCTION studio_v03.enforce_job_asset_integrity() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 DECLARE item_count INTEGER;
 BEGIN
  -- A terminal row is entirely immutable, including edits to payload or job identity.
  IF OLD.state IN ('COMPLETED','FAILED') THEN
    RAISE EXCEPTION 'TERMINAL_JOB_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.state='COMPLETED' AND OLD.state IS DISTINCT FROM NEW.state THEN
   SELECT COUNT(*) INTO item_count FROM studio_v03.assets WHERE job_id=NEW.id;
   IF item_count<>3 THEN
    RAISE EXCEPTION 'COMPLETED_JOB_REQUIRES_THREE_ASSETS' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END;
 $body$;
-- @statement
CREATE OR REPLACE TRIGGER job_state_integrity BEFORE UPDATE ON studio_v03.jobs
 FOR EACH ROW EXECUTE FUNCTION studio_v03.enforce_job_asset_integrity();
-- @statement
CREATE OR REPLACE FUNCTION studio_v03.enforce_asset_integrity() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 DECLARE current_state TEXT;
 BEGIN
  -- Row locks serialize asset writes with job completion. Never rely on a
  -- nonlocking SELECT because the completion transaction updates jobs.state.
  IF TG_OP='INSERT' THEN
    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=NEW.job_id FOR UPDATE;
    IF current_state IS NULL OR current_state NOT IN ('RUNNING','DISPATCHING') THEN
      RAISE EXCEPTION 'ASSET_INSERT_NONACTIVE_JOB' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='UPDATE' THEN
    -- Checking only NEW.job_id previously permitted moving a completed-job
    -- artifact to an active job and thereby evading completed immutability.
    IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
      RAISE EXCEPTION 'ASSET_JOB_REASSIGNMENT_DENIED' USING ERRCODE='23514';
    END IF;
    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=OLD.job_id FOR UPDATE;
    IF current_state IS NULL OR current_state='COMPLETED' THEN
      RAISE EXCEPTION 'COMPLETED_ASSET_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=OLD.job_id FOR UPDATE;
    IF current_state IS NULL OR current_state='COMPLETED' THEN
      RAISE EXCEPTION 'COMPLETED_ASSET_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'INVALID_ASSET_TRIGGER_ACTION' USING ERRCODE='23514';
 END;
 $body$;
-- @statement
INSERT INTO studio_v03._studio_schema_versions(version,applied_at)
 VALUES(2,'2026-10-21T00:00:00Z') ON CONFLICT(version) DO NOTHING;
