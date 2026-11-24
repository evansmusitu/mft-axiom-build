-- MUSITU Studio G5/G6 source-only Durable Object SQLite candidate.
-- DO NOT execute against existing Studio QA, AXIOM, R2 or live customer stores.
-- A separate new Durable Object namespace and independently reviewed migration
-- and authenticated service boundary are required before hosted activation.
-- Schema invariants alone DO NOT provide real provider spend caps or isolation.

PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS g56_do_control(
  id INTEGER PRIMARY KEY CHECK(id=1),
  killed INTEGER NOT NULL DEFAULT 1 CHECK(killed IN (0,1)),
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO g56_do_control(id,killed,updated_at) VALUES(1,1,0);

CREATE TABLE IF NOT EXISTS g56_do_tenants(
  tenant TEXT PRIMARY KEY,
  daily_cents INTEGER NOT NULL CHECK(daily_cents>0),
  monthly_cents INTEGER NOT NULL CHECK(monthly_cents>=daily_cents),
  max_active INTEGER NOT NULL CHECK(max_active BETWEEN 1 AND 5),
  total_credit_units INTEGER NOT NULL CHECK(total_credit_units>=0)
);

CREATE TABLE IF NOT EXISTS g56_do_jobs(
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL REFERENCES g56_do_tenants(tenant),
  project TEXT NOT NULL,
  submission_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  state TEXT NOT NULL CHECK(state IN (
     'QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW',
     'COMPLETED','FAILED','CANCELED')),
  reserved_cents INTEGER NOT NULL CHECK(reserved_cents>0),
  charged_cents INTEGER CHECK(
     charged_cents IS NULL OR (charged_cents>=0 AND charged_cents<=reserved_cents)),
  credit_hold INTEGER NOT NULL CHECK(credit_hold>=0),
  credit_charge INTEGER CHECK(
     credit_charge IS NULL OR (credit_charge>=0 AND credit_charge<=credit_hold)),
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 2),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(
     attempts>=0 AND attempts<=max_attempts),
  current_fence TEXT UNIQUE,
  lease_until INTEGER,
  provider_call_id TEXT UNIQUE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  outcome_code TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE(tenant,submission_key)
);
CREATE INDEX IF NOT EXISTS g56_do_jobs_pending
  ON g56_do_jobs(state,created,id);
CREATE INDEX IF NOT EXISTS g56_do_jobs_tenant_created
  ON g56_do_jobs(tenant,created);

CREATE TABLE IF NOT EXISTS g56_do_attempts(
  job_id TEXT NOT NULL REFERENCES g56_do_jobs(id),
  attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
  fence TEXT NOT NULL UNIQUE,
  worker_id TEXT NOT NULL,
  provider_call_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'CLAIMED' CHECK(state IN (
     'CLAIMED','DISPATCHED','FINISHED','UNCERTAIN','STOPPED_VERIFIED')),
  started INTEGER NOT NULL,
  finished INTEGER,
  PRIMARY KEY(job_id,attempt_no)
);

CREATE TABLE IF NOT EXISTS g56_do_artifacts(
  job_id TEXT NOT NULL REFERENCES g56_do_jobs(id),
  filename TEXT NOT NULL CHECK(filename IN (
     'scene.blend','scene.glb','preview.png')),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1024 AND 67108864),
  private_key TEXT NOT NULL UNIQUE CHECK(private_key LIKE 'private/%'),
  PRIMARY KEY(job_id,filename)
);

CREATE TABLE IF NOT EXISTS g56_do_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES g56_do_jobs(id),
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS g56_do_events_immutable_update
 BEFORE UPDATE ON g56_do_events
 BEGIN SELECT RAISE(ABORT,'G56_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS g56_do_events_immutable_delete
 BEFORE DELETE ON g56_do_events
 BEGIN SELECT RAISE(ABORT,'G56_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS g56_do_terminal_immutable
 BEFORE UPDATE OF state ON g56_do_jobs
 WHEN OLD.state IN ('COMPLETED','FAILED','CANCELED')
      AND NEW.state<>OLD.state
 BEGIN SELECT RAISE(ABORT,'G56_TERMINAL_JOB_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS g56_do_completion_verified
 BEFORE UPDATE OF state ON g56_do_jobs
 WHEN NEW.state='COMPLETED' AND OLD.state<>'COMPLETED'
      AND (NEW.charged_cents IS NULL
           OR NEW.credit_charge IS NULL
           OR (SELECT COUNT(*) FROM g56_do_artifacts
               WHERE job_id=NEW.id)!=3)
 BEGIN SELECT RAISE(ABORT,'G56_COMPLETION_NOT_RECONCILED'); END;

CREATE TRIGGER IF NOT EXISTS g56_do_completed_asset_immutable_update
 BEFORE UPDATE ON g56_do_artifacts
 WHEN (SELECT state FROM g56_do_jobs WHERE id=OLD.job_id)='COMPLETED'
 BEGIN SELECT RAISE(ABORT,'G56_COMPLETED_ASSET_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS g56_do_completed_asset_immutable_delete
 BEFORE DELETE ON g56_do_artifacts
 WHEN (SELECT state FROM g56_do_jobs WHERE id=OLD.job)='COMPLETED'
 BEGIN SELECT RAISE(ABORT,'G56_COMPLETED_ASSET_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS g56_do_no_job_delete
 BEFORE DELETE ON g56_do_jobs
 BEGIN SELECT RAISE(ABORT,'G56_JOB_DELETE_REQUIRES_REVIEW'); END;
