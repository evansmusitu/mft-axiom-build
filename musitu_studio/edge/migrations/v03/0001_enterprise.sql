-- MUSITU Studio V0.3: dedicated NEW D1 database ONLY (musitu-studio-v03).
-- Never execute against the existing MUSITU Axiom or Studio v02 database.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 owner_sub TEXT NOT NULL CHECK(length(owner_sub) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 member_sub TEXT NOT NULL CHECK(length(member_sub) BETWEEN 1 AND 200),
 role TEXT NOT NULL CHECK(role IN ('owner','editor','reviewer','viewer')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,member_sub)
);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_sub,project_id);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 submission_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL CHECK(length(payload_json) BETWEEN 30 AND 65536),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
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
CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON jobs(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state,created_at DESC);
CREATE TABLE IF NOT EXISTS assets (
 job_id TEXT NOT NULL REFERENCES jobs(id),
 filename TEXT NOT NULL CHECK(filename IN ('scene.blend','scene.glb','preview.png')),
 object_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 bytes INTEGER NOT NULL CHECK(bytes>=1024 AND bytes<=5000000),
 PRIMARY KEY(job_id,filename)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY,
 project_id TEXT REFERENCES projects(id),
 job_id TEXT REFERENCES jobs(id),
 action TEXT NOT NULL,
 actor_sub TEXT,
 at TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_project_at ON audit_events(project_id,at DESC);
CREATE TRIGGER IF NOT EXISTS immutable_audit_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS immutable_audit_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
-- No migrated production data automatically. Run the explicit importer after
-- a human-approved read-only source snapshot, backup and per-job hash checks.
