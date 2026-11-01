-- Separate candidate tables: this migration never rewrites legacy task history.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS axiom_ec_projects (
 tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')),
 PRIMARY KEY(tenant_id,project_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_agents (
 tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')),
 PRIMARY KEY(tenant_id,agent_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_works (
 tenant_id TEXT NOT NULL, work_id TEXT NOT NULL, project_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 request_sha256 TEXT NOT NULL, contract_sha256 TEXT NOT NULL, contract_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')), expires_at TEXT NOT NULL,
 max_compute_calls INTEGER NOT NULL CHECK(max_compute_calls>=0), max_provider_calls INTEGER NOT NULL CHECK(max_provider_calls>=0),
 compute_calls INTEGER NOT NULL DEFAULT 0 CHECK(compute_calls>=0 AND compute_calls<=max_compute_calls),
 provider_calls INTEGER NOT NULL DEFAULT 0 CHECK(provider_calls>=0 AND provider_calls<=max_provider_calls),
 PRIMARY KEY(tenant_id,work_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES axiom_ec_projects(tenant_id,project_id),
 FOREIGN KEY(tenant_id,agent_id) REFERENCES axiom_ec_agents(tenant_id,agent_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_runs (
 tenant_id TEXT NOT NULL, task_id TEXT NOT NULL, work_id TEXT NOT NULL, contract_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('RUNNING','COMPLETED','FAILED')),
 binding_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>=1), lease_expires_at TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, result_json TEXT NOT NULL,
 PRIMARY KEY(tenant_id,task_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_artifacts (
 tenant_id TEXT NOT NULL, artifact_id TEXT NOT NULL, task_id TEXT NOT NULL, work_id TEXT NOT NULL,
 content_sha256 TEXT NOT NULL, content_json TEXT NOT NULL, binding_id TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,artifact_id), UNIQUE(tenant_id,task_id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES axiom_ec_runs(tenant_id,task_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_reservations (
 tenant_id TEXT NOT NULL, reservation_id TEXT NOT NULL, work_id TEXT NOT NULL, task_id TEXT,
 binding_id TEXT NOT NULL, generation INTEGER, action_kind TEXT NOT NULL, operation TEXT,
 compute_calls INTEGER NOT NULL, provider_calls INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES axiom_ec_runs(tenant_id,task_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_evidence (
 tenant_id TEXT NOT NULL, evidence_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
 kind TEXT NOT NULL, content_sha256 TEXT NOT NULL, content_json TEXT NOT NULL,
 PRIMARY KEY(tenant_id,evidence_id),
 FOREIGN KEY(tenant_id,artifact_id) REFERENCES axiom_ec_artifacts(tenant_id,artifact_id)
);
CREATE TRIGGER IF NOT EXISTS axiom_ec_artifact_active_lease BEFORE INSERT ON axiom_ec_artifacts
WHEN NOT EXISTS (
 SELECT 1 FROM axiom_ec_runs r JOIN axiom_ec_works w ON w.tenant_id=r.tenant_id AND w.work_id=r.work_id
 JOIN axiom_ec_projects p ON p.tenant_id=w.tenant_id AND p.project_id=w.project_id
 JOIN axiom_ec_agents a ON a.tenant_id=w.tenant_id AND a.agent_id=w.agent_id
 WHERE r.tenant_id=NEW.tenant_id AND r.task_id=NEW.task_id AND r.work_id=NEW.work_id
 AND r.status='RUNNING' AND r.binding_id=NEW.binding_id AND r.generation=NEW.generation
 AND r.contract_sha256=w.contract_sha256 AND w.state='ACTIVE' AND p.state='ACTIVE' AND a.state='ACTIVE'
 AND r.lease_expires_at>NEW.created_at AND w.expires_at>NEW.created_at
)
BEGIN SELECT RAISE(ABORT,'execution lease or authority is not active'); END;
CREATE INDEX IF NOT EXISTS axiom_ec_runs_work ON axiom_ec_runs(tenant_id,work_id,started_at);
-- Hosted model invocations are linked to an existing admitted reservation.
-- A pending/uncertain row is never permission to resend the input.
CREATE TABLE IF NOT EXISTS axiom_ec_agent_invocations (
 tenant_id TEXT NOT NULL, invocation_id TEXT NOT NULL, task_id TEXT NOT NULL, work_id TEXT NOT NULL,
 contract_sha256 TEXT NOT NULL, reservation_id TEXT NOT NULL, binding_id TEXT NOT NULL, generation INTEGER NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN('planning','synthesis')), provider TEXT NOT NULL, model TEXT NOT NULL,
 request_sha256 TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('STARTED','UNCERTAIN','SUCCEEDED')),
 session_id TEXT, turn_id TEXT, output_json TEXT, output_sha256 TEXT, error_code TEXT,
 reconcile_reads INTEGER NOT NULL DEFAULT 0 CHECK(reconcile_reads>=0 AND reconcile_reads<=3),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,invocation_id), UNIQUE(tenant_id,task_id,stage), UNIQUE(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES axiom_ec_runs(tenant_id,task_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES axiom_ec_reservations(tenant_id,reservation_id)
);
CREATE TABLE IF NOT EXISTS axiom_ec_agent_completion_guards (
 tenant_id TEXT NOT NULL, task_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 PRIMARY KEY(tenant_id,task_id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES axiom_ec_runs(tenant_id,task_id)
);
-- The verified invocation set must remain unchanged at the atomic artifact commit.
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_completion_snapshot BEFORE INSERT ON axiom_ec_agent_completion_guards
WHEN NOT json_valid(NEW.snapshot_json) OR json_type(NEW.snapshot_json)!='array'
 OR json_array_length(NEW.snapshot_json)!=(SELECT COUNT(*) FROM axiom_ec_agent_invocations i WHERE i.tenant_id=NEW.tenant_id AND i.task_id=NEW.task_id)
 OR EXISTS (
  SELECT 1 FROM axiom_ec_agent_invocations i WHERE i.tenant_id=NEW.tenant_id AND i.task_id=NEW.task_id AND (
   i.status!='SUCCEEDED' OR i.provider!='openai_agents' OR NOT EXISTS (
    SELECT 1 FROM json_each(NEW.snapshot_json) s WHERE json_extract(s.value,'$.invocation_id')=i.invocation_id
     AND json_extract(s.value,'$.session_id')=i.session_id AND json_extract(s.value,'$.turn_id')=i.turn_id
     AND json_extract(s.value,'$.request_sha256')=i.request_sha256 AND json_extract(s.value,'$.output_sha256')=i.output_sha256
     AND json_extract(s.value,'$.output_json')=i.output_json AND json_extract(s.value,'$.provider')=i.provider
     AND json_extract(s.value,'$.model')=i.model AND json_extract(s.value,'$.stage')=i.stage
     AND json_extract(s.value,'$.work_id')=i.work_id AND json_extract(s.value,'$.contract_sha256')=i.contract_sha256
     AND json_extract(s.value,'$.reservation_id')=i.reservation_id AND json_extract(s.value,'$.binding_id')=i.binding_id
     AND json_extract(s.value,'$.generation')=i.generation
   ) OR NOT EXISTS (
    SELECT 1 FROM axiom_ec_runs r JOIN axiom_ec_reservations z ON z.tenant_id=r.tenant_id AND z.task_id=r.task_id
    WHERE r.tenant_id=i.tenant_id AND r.task_id=i.task_id AND r.status='RUNNING'
     AND r.binding_id=i.binding_id AND r.generation=i.generation AND r.contract_sha256=i.contract_sha256 AND r.work_id=i.work_id
     AND z.reservation_id=i.reservation_id AND z.work_id=i.work_id AND z.binding_id=i.binding_id AND z.generation=i.generation
     AND z.action_kind='model' AND z.provider_calls>=1
   )
  )
 )
BEGIN SELECT RAISE(ABORT,'hosted invocation set changed during completion'); END;
