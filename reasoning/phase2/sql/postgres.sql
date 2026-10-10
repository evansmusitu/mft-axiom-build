CREATE TABLE IF NOT EXISTS axiom_temporal_facts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value_json JSONB NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  supersedes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acquisition_json JSONB,
  authentication_json JSONB,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE axiom_temporal_facts
  ADD COLUMN IF NOT EXISTS acquisition_json JSONB;

ALTER TABLE axiom_temporal_facts
  ADD COLUMN IF NOT EXISTS authentication_json JSONB;

CREATE INDEX IF NOT EXISTS axiom_temporal_lookup
  ON axiom_temporal_facts(tenant_id, entity, attribute, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS axiom_world_snapshots (
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS axiom_platform_executions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS axiom_execution_intents (
  tenant_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, intent_id)
);

CREATE TABLE IF NOT EXISTS axiom_evidence_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  artifact_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS axiom_evidence_acquisitions (
  tenant_id TEXT NOT NULL,
  acquisition_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, acquisition_id)
);

CREATE TABLE IF NOT EXISTS axiom_ingestion_nonces (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key_id, nonce)
);

CREATE TABLE IF NOT EXISTS axiom_authorization_grants (
  principal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  PRIMARY KEY (principal_id, tenant_id, action, grant_id)
);

CREATE TABLE IF NOT EXISTS axiom_idempotency_records (
  principal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETE')),
  status_code INTEGER,
  body_json TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (principal_id, tenant_id, action, idempotency_key_hash)
);

CREATE TABLE IF NOT EXISTS axiom_audit_heads (
  tenant_id TEXT PRIMARY KEY,
  record_count BIGINT NOT NULL,
  head_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS axiom_audit_records (
  tenant_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  request_id TEXT NOT NULL,
  principal_id TEXT,
  action TEXT NOT NULL,
  resource_json JSONB NOT NULL,
  credential_token_hash TEXT,
  authorization_decision_hash TEXT,
  request_hash TEXT NOT NULL,
  idempotency_key_hash TEXT,
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sequence)
);


CREATE TABLE IF NOT EXISTS axiom_model_exchange_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  request_body_hash TEXT NOT NULL,
  response_body_hash TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_body TEXT NOT NULL,
  artifact_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS axiom_model_compilations (
  tenant_id TEXT NOT NULL,
  compilation_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  compiled_program_hash TEXT,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, compilation_id)
);


CREATE TABLE IF NOT EXISTS axiom_model_explanations (
  tenant_id TEXT NOT NULL,
  explanation_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  request_body_hash TEXT NOT NULL,
  response_body_hash TEXT NOT NULL,
  normalized_response_body_hash TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_body TEXT NOT NULL,
  normalized_response_body TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, explanation_id)
);


CREATE TABLE IF NOT EXISTS axiom_distributed_execution_jobs (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  intent_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','LEASED','SUCCEEDED','DENIED','STALE','FAILED_INTEGRITY')),
  lease_epoch BIGINT NOT NULL,
  attempt_count BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  lease_worker_key_id TEXT,
  lease_pool_id TEXT,
  lease_capability_core_hash TEXT,
  terminal_at TEXT,
  result_json JSONB,
  result_hash TEXT,
  failure_code TEXT,
  state_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (job_id)
);

ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_worker_key_id TEXT;
ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_pool_id TEXT;
ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_capability_core_hash TEXT;

CREATE INDEX IF NOT EXISTS axiom_distributed_execution_claim
  ON axiom_distributed_execution_jobs(status, lease_expires_at, created_at, job_id);

CREATE TABLE IF NOT EXISTS axiom_worker_operation_receipts (
  worker_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  worker_key_id TEXT NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  outcome_json JSONB NOT NULL,
  outcome_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  PRIMARY KEY(worker_id, request_id)
);
