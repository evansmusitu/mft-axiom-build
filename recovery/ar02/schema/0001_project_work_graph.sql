PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

CREATE TABLE ar02_environment (
  environment_id TEXT PRIMARY KEY
    CHECK (environment_id IN ('development', 'staging', 'canary')),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  schema_sha256 TEXT NOT NULL CHECK (length(schema_sha256) = 64),
  synthetic_data_only INTEGER NOT NULL CHECK (synthetic_data_only = 1),
  production_authority INTEGER NOT NULL CHECK (production_authority = 0),
  provisioned_at TEXT NOT NULL
);

CREATE TABLE axiom_tenants (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id),
  FOREIGN KEY (environment_id) REFERENCES ar02_environment(environment_id)
);

CREATE TABLE axiom_actors (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'SERVICE', 'AGENT')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, actor_id),
  FOREIGN KEY (environment_id, tenant_id)
    REFERENCES axiom_tenants(environment_id, tenant_id)
);

CREATE TABLE axiom_projects (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  data_classification TEXT NOT NULL DEFAULT 'SYNTHETIC'
    CHECK (data_classification = 'SYNTHETIC'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, project_id),
  FOREIGN KEY (environment_id, tenant_id)
    REFERENCES axiom_tenants(environment_id, tenant_id)
);

CREATE TABLE axiom_project_members (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, project_id, actor_id),
  FOREIGN KEY (environment_id, tenant_id, project_id)
    REFERENCES axiom_projects(environment_id, tenant_id, project_id),
  FOREIGN KEY (environment_id, tenant_id, actor_id)
    REFERENCES axiom_actors(environment_id, tenant_id, actor_id)
);

CREATE TABLE axiom_work_objects (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, project_id, object_id),
  FOREIGN KEY (environment_id, tenant_id, project_id)
    REFERENCES axiom_projects(environment_id, tenant_id, project_id),
  FOREIGN KEY (environment_id, tenant_id, created_by)
    REFERENCES axiom_actors(environment_id, tenant_id, actor_id)
);

CREATE TABLE axiom_work_edges (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  from_object_id TEXT NOT NULL,
  to_object_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, project_id, edge_id),
  FOREIGN KEY (environment_id, tenant_id, project_id, from_object_id)
    REFERENCES axiom_work_objects(environment_id, tenant_id, project_id, object_id),
  FOREIGN KEY (environment_id, tenant_id, project_id, to_object_id)
    REFERENCES axiom_work_objects(environment_id, tenant_id, project_id, object_id),
  CHECK (from_object_id <> to_object_id)
);

CREATE TABLE axiom_tasks (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  user_intent_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('ADMITTED', 'PLANNING', 'WAITING_APPROVAL', 'RUNNING', 'PAUSED',
              'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  idempotency_key TEXT NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 0 CHECK (plan_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, task_id),
  UNIQUE (environment_id, tenant_id, idempotency_key),
  FOREIGN KEY (environment_id, tenant_id, project_id)
    REFERENCES axiom_projects(environment_id, tenant_id, project_id)
);

CREATE TABLE axiom_task_steps (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  state TEXT NOT NULL CHECK (
    state IN ('PENDING', 'READY', 'LEASED', 'RUNNING', 'WAITING_APPROVAL',
              'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  tool_id TEXT,
  tool_version TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  idempotency_key TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  checkpoint_ref TEXT,
  input_sha256 TEXT,
  output_sha256 TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, task_id, step_id),
  UNIQUE (environment_id, tenant_id, task_id, ordinal),
  UNIQUE (environment_id, tenant_id, idempotency_key),
  FOREIGN KEY (environment_id, tenant_id, task_id)
    REFERENCES axiom_tasks(environment_id, tenant_id, task_id)
);

CREATE TABLE axiom_task_events (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_type TEXT NOT NULL,
  step_id TEXT,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, task_id, event_id),
  UNIQUE (environment_id, tenant_id, task_id, sequence),
  FOREIGN KEY (environment_id, tenant_id, task_id)
    REFERENCES axiom_tasks(environment_id, tenant_id, task_id)
);

CREATE TABLE axiom_idempotency_keys (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  response_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'COMPLETED', 'FAILED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, scope, idempotency_key),
  FOREIGN KEY (environment_id, tenant_id)
    REFERENCES axiom_tenants(environment_id, tenant_id)
);

CREATE TABLE axiom_approval_grants (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  arguments_sha256 TEXT NOT NULL CHECK (length(arguments_sha256) = 64),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('S0', 'S1', 'S2', 'S3', 'S4')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  signature TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, approval_id),
  FOREIGN KEY (environment_id, tenant_id, task_id, step_id)
    REFERENCES axiom_task_steps(environment_id, tenant_id, task_id, step_id),
  FOREIGN KEY (environment_id, tenant_id, approver_id)
    REFERENCES axiom_actors(environment_id, tenant_id, actor_id)
);

CREATE TABLE axiom_tool_receipts (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'AMBIGUOUS')),
  output_sha256 TEXT,
  receipt_json TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL CHECK (length(receipt_sha256) = 64),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, receipt_id),
  UNIQUE (environment_id, tenant_id, invocation_id),
  FOREIGN KEY (environment_id, tenant_id, task_id, step_id)
    REFERENCES axiom_task_steps(environment_id, tenant_id, task_id, step_id)
);

CREATE TABLE axiom_artifacts (
  environment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  storage_ref TEXT NOT NULL,
  source_receipts_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment_id, tenant_id, project_id, artifact_id, version),
  FOREIGN KEY (environment_id, tenant_id, project_id)
    REFERENCES axiom_projects(environment_id, tenant_id, project_id),
  FOREIGN KEY (environment_id, tenant_id, task_id)
    REFERENCES axiom_tasks(environment_id, tenant_id, task_id),
  FOREIGN KEY (environment_id, tenant_id, created_by)
    REFERENCES axiom_actors(environment_id, tenant_id, actor_id)
);

CREATE INDEX idx_axiom_projects_updated
  ON axiom_projects(environment_id, tenant_id, updated_at DESC);
CREATE INDEX idx_axiom_work_objects_project_type
  ON axiom_work_objects(environment_id, tenant_id, project_id, object_type);
CREATE INDEX idx_axiom_tasks_project_updated
  ON axiom_tasks(environment_id, tenant_id, project_id, updated_at DESC);
CREATE INDEX idx_axiom_task_steps_ready
  ON axiom_task_steps(environment_id, state, lease_expires_at, ordinal);
CREATE INDEX idx_axiom_task_events_sequence
  ON axiom_task_events(environment_id, tenant_id, task_id, sequence);
CREATE INDEX idx_axiom_receipts_task_step
  ON axiom_tool_receipts(environment_id, tenant_id, task_id, step_id);
CREATE INDEX idx_axiom_artifacts_project_created
  ON axiom_artifacts(environment_id, tenant_id, project_id, created_at DESC);
