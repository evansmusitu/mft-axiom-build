-- Dedicated studio database. Never run against the existing Axiom D1 database.
CREATE TABLE IF NOT EXISTS projects(
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 submission_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL,
 render_device TEXT NOT NULL CHECK(render_device IN ('CPU','GPU')),
 state TEXT NOT NULL CHECK(state IN ('PENDING_APPROVAL','APPROVED','DISPATCHING','RUNNING','COMPLETED','FAILED')),
 error TEXT,
 created_at TEXT NOT NULL,
 approved_at TEXT,
 finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id,created_at);
CREATE TABLE IF NOT EXISTS assets(
 job_id TEXT NOT NULL REFERENCES jobs(id),
 filename TEXT NOT NULL,
 object_key TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 PRIMARY KEY(job_id,filename)
);
CREATE TABLE IF NOT EXISTS audit_events(
 id TEXT PRIMARY KEY,job_id TEXT,action TEXT NOT NULL,at TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}'
);
