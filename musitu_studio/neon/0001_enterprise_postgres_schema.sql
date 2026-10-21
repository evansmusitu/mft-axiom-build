-- MUSITU Studio V0.3: PostgreSQL 17+ staging schema (never apply to existing customer project)
-- Dedicated Neon project only. Source of truth stays Cloudflare DO until gated cutover.
-- @statement
CREATE SCHEMA IF NOT EXISTS studio_v03;
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03._studio_schema_versions(
 version INTEGER PRIMARY KEY,
 applied_at TEXT NOT NULL
);
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03.projects(
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 owner_sub TEXT NOT NULL CHECK(char_length(owner_sub) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL
);
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03.memberships(
 project_id TEXT NOT NULL REFERENCES studio_v03.projects(id) ON DELETE CASCADE,
 member_sub TEXT NOT NULL CHECK(char_length(member_sub) BETWEEN 1 AND 200),
 role TEXT NOT NULL CHECK(role IN ('owner','editor','reviewer','viewer')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,member_sub)
);
-- @statement
CREATE INDEX IF NOT EXISTS idx_studio_v03_memberships_member
 ON studio_v03.memberships(member_sub,project_id);
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03.jobs(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES studio_v03.projects(id),
 submission_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL CHECK(char_length(payload_json) BETWEEN 30 AND 65536),
 payload_sha256 TEXT NOT NULL CHECK(char_length(payload_sha256)=64),
 render_device TEXT NOT NULL CHECK(render_device='CPU'),
 state TEXT NOT NULL CHECK(state IN ('PENDING_APPROVAL','APPROVED','DISPATCHING','RUNNING','COMPLETED','FAILED','NEEDS_REVIEW')),
 created_by_sub TEXT NOT NULL,
 approved_by_sub TEXT,
 dispatched_by_sub TEXT,
 call_id TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 approved_at TEXT,
 dispatched_at TEXT,
 finished_at TEXT
);
-- @statement
CREATE INDEX IF NOT EXISTS idx_studio_v03_jobs_project_created
 ON studio_v03.jobs(project_id,created_at DESC);
-- @statement
CREATE INDEX IF NOT EXISTS idx_studio_v03_jobs_state_created
 ON studio_v03.jobs(state,created_at DESC);
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03.assets(
 job_id TEXT NOT NULL REFERENCES studio_v03.jobs(id),
 filename TEXT NOT NULL CHECK(filename IN ('scene.blend','scene.glb','preview.png')),
 object_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(char_length(sha256)=64),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1024 AND 5000000),
 PRIMARY KEY(job_id,filename)
);
-- @statement
CREATE TABLE IF NOT EXISTS studio_v03.audit_events(
 id TEXT PRIMARY KEY,
 project_id TEXT REFERENCES studio_v03.projects(id),
 job_id TEXT REFERENCES studio_v03.jobs(id),
 action TEXT NOT NULL,
 actor_sub TEXT,
 at TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}'
);
-- @statement
CREATE INDEX IF NOT EXISTS idx_studio_v03_audit_project_at
 ON studio_v03.audit_events(project_id,at DESC);
-- @statement
CREATE OR REPLACE FUNCTION studio_v03.deny_audit_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='23514'; END;
 $body$;
-- @statement
CREATE OR REPLACE TRIGGER audit_immutable_update BEFORE UPDATE
 ON studio_v03.audit_events FOR EACH ROW EXECUTE FUNCTION studio_v03.deny_audit_mutation();
-- @statement
CREATE OR REPLACE TRIGGER audit_immutable_delete BEFORE DELETE
 ON studio_v03.audit_events FOR EACH ROW EXECUTE FUNCTION studio_v03.deny_audit_mutation();
-- @statement
CREATE OR REPLACE FUNCTION studio_v03.enforce_job_asset_integrity() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 DECLARE item_count INTEGER;
 BEGIN
  IF OLD.state IN ('COMPLETED','FAILED') AND NEW.state<>OLD.state THEN
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
CREATE OR REPLACE TRIGGER job_state_integrity BEFORE UPDATE OF state
 ON studio_v03.jobs FOR EACH ROW EXECUTE FUNCTION studio_v03.enforce_job_asset_integrity();
-- @statement
CREATE OR REPLACE FUNCTION studio_v03.enforce_asset_integrity() RETURNS trigger
 LANGUAGE plpgsql AS $body$
 DECLARE current_state TEXT;
 BEGIN
  IF TG_OP='DELETE' THEN
    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=OLD.job_id;
  ELSE
    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=NEW.job_id;
  END IF;
  IF TG_OP='INSERT' AND current_state NOT IN ('RUNNING','DISPATCHING') THEN
    RAISE EXCEPTION 'ASSET_INSERT_NONACTIVE_JOB' USING ERRCODE='23514';
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND current_state='COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETED_ASSET_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END;
 $body$;
-- @statement
CREATE OR REPLACE TRIGGER asset_insert_integrity BEFORE INSERT ON studio_v03.assets
 FOR EACH ROW EXECUTE FUNCTION studio_v03.enforce_asset_integrity();
-- @statement
CREATE OR REPLACE TRIGGER asset_update_integrity BEFORE UPDATE ON studio_v03.assets
 FOR EACH ROW EXECUTE FUNCTION studio_v03.enforce_asset_integrity();
-- @statement
CREATE OR REPLACE TRIGGER asset_delete_integrity BEFORE DELETE ON studio_v03.assets
 FOR EACH ROW EXECUTE FUNCTION studio_v03.enforce_asset_integrity();
-- @statement
INSERT INTO studio_v03._studio_schema_versions(version,applied_at) VALUES(1,'2026-10-21T00:00:00Z')
 ON CONFLICT(version) DO NOTHING;
