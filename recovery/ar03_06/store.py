from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .common import IntegrityError, now_ms, sha256_text


SCHEMA = r"""
CREATE TABLE IF NOT EXISTS candidate_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users(
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations(
  organization_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(user_id),
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships(
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS entitlements(
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  capability TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(organization_id,capability)
);
CREATE TABLE IF NOT EXISTS sessions(
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  token_digest TEXT UNIQUE NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS api_keys(
  key_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  created_by TEXT NOT NULL REFERENCES users(user_id),
  secret_digest TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  revoked_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS oauth_links(
  link_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  provider TEXT NOT NULL,
  external_subject TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  token_material_stored INTEGER NOT NULL CHECK(token_material_stored=0),
  created_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  UNIQUE(provider,external_subject)
);
CREATE TABLE IF NOT EXISTS recovery_tokens(
  recovery_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  token_digest TEXT UNIQUE NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS audit_events(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  organization_id TEXT,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  previous_event_sha256 TEXT,
  event_sha256 TEXT UNIQUE NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects(
  project_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(user_id),
  version INTEGER NOT NULL CHECK(version>=1),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS graph_entities(
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>=1),
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),
  provenance_json TEXT NOT NULL,
  provenance_sha256 TEXT NOT NULL CHECK(length(provenance_sha256)=64),
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(organization_id,project_id,entity_id),
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
);
CREATE TABLE IF NOT EXISTS graph_events(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  previous_event_sha256 TEXT,
  event_sha256 TEXT UNIQUE NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
);
CREATE TABLE IF NOT EXISTS import_keys(
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_store TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  imported_sha256 TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(organization_id,project_id,source_store,source_object_id)
);
CREATE TABLE IF NOT EXISTS tasks(
  task_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  idempotency_key TEXT NOT NULL,
  budget_max INTEGER NOT NULL CHECK(budget_max>=0),
  budget_used INTEGER NOT NULL DEFAULT 0 CHECK(budget_used>=0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(organization_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS task_steps(
  step_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  operation TEXT NOT NULL,
  args_json TEXT NOT NULL,
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
  risk_class TEXT NOT NULL CHECK(risk_class IN ('S0','S1','S2','S3','S4','S5')),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts INTEGER NOT NULL CHECK(max_attempts>=1),
  idempotency_key TEXT NOT NULL,
  cost_units INTEGER NOT NULL CHECK(cost_units>=0),
  approval_required INTEGER NOT NULL CHECK(approval_required IN (0,1)),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  invocation_id TEXT NOT NULL,
  output_json TEXT,
  output_sha256 TEXT,
  last_error TEXT,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(task_id,ordinal),
  UNIQUE(task_id,idempotency_key),
  UNIQUE(invocation_id)
);
CREATE TABLE IF NOT EXISTS approval_grants(
  approval_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  grant_sha256 TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS task_events(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  previous_event_sha256 TEXT,
  event_sha256 TEXT UNIQUE NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_receipts(
  receipt_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  invocation_id TEXT UNIQUE NOT NULL,
  operation TEXT NOT NULL,
  lane TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  qualification TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_sha256 TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_sha256 TEXT UNIQUE NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id,status);
CREATE INDEX IF NOT EXISTS idx_audit_org_sequence ON audit_events(organization_id,sequence);
CREATE INDEX IF NOT EXISTS idx_graph_project_sequence ON graph_events(organization_id,project_id,sequence);
CREATE INDEX IF NOT EXISTS idx_graph_entities_project ON graph_entities(organization_id,project_id,entity_type);
CREATE INDEX IF NOT EXISTS idx_task_steps_ready ON task_steps(status,lease_expires_at_ms,ordinal);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id,sequence);
"""


class CandidateStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(
            self.path,
            isolation_level=None,
            timeout=5,
            check_same_thread=False,
        )
        os.chmod(self.path, 0o600)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=5000")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript(SCHEMA)
        self._bind_schema()

    def _bind_schema(self):
        digest = sha256_text(SCHEMA)
        existing = self.connection.execute(
            "SELECT value FROM candidate_meta WHERE key='schema_sha256'"
        ).fetchone()
        if existing and existing["value"] != digest:
            raise IntegrityError("candidate schema digest mismatch")
        with self.transaction(immediate=True):
            self.connection.execute(
                "INSERT OR IGNORE INTO candidate_meta(key,value) VALUES('schema_sha256',?)",
                (digest,),
            )
            self.connection.execute(
                "INSERT OR IGNORE INTO candidate_meta(key,value) VALUES('production_authority','false')"
            )
            self.connection.execute(
                "INSERT OR IGNORE INTO candidate_meta(key,value) VALUES('provider_execution','false')"
            )
            self.connection.execute(
                "INSERT OR IGNORE INTO candidate_meta(key,value) VALUES('created_at_ms',?)",
                (str(now_ms()),),
            )

    @contextmanager
    def transaction(self, *, immediate=False):
        self.connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        try:
            yield self.connection
        except Exception:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def close(self):
        self.connection.close()
