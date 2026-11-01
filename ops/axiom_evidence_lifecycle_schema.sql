-- Candidate, server-only logical erasure control plane for the five-object store.
-- Apply after axiom_execution_contract_schema.sql. No execution actions/grants are added.
-- Authorizations must be provisioned separately by a trusted owner, for one exact
-- tenant/action/Work. This migration intentionally creates NO authorization rows.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS axiom_lc_schema(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT OR IGNORE INTO axiom_lc_schema(version) VALUES(1);
CREATE TABLE IF NOT EXISTS axiom_lc_authorizations(
 tenant_id TEXT NOT NULL, authorization_id TEXT NOT NULL, principal_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('lifecycle.plan','lifecycle.export','lifecycle.hold','lifecycle.dependency','lifecycle.delete','lifecycle.read')),
 work_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')), expires_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,authorization_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_lc_holds(
 tenant_id TEXT NOT NULL, hold_id TEXT NOT NULL, work_id TEXT NOT NULL,
 object_kind TEXT NOT NULL CHECK(object_kind IN('WORK','ARTIFACT','EVIDENCE')), object_id TEXT NOT NULL,
 reason TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','RELEASED')),
 principal_id TEXT NOT NULL, authorization_id TEXT NOT NULL, created_at TEXT NOT NULL,
 released_at TEXT, released_by TEXT, released_authorization_id TEXT, release_reason TEXT,
 PRIMARY KEY(tenant_id,hold_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_lc_dependencies(
 tenant_id TEXT NOT NULL, dependency_id TEXT NOT NULL, work_id TEXT NOT NULL, dependent_work_id TEXT NOT NULL,
 object_kind TEXT NOT NULL CHECK(object_kind IN('WORK','ARTIFACT','EVIDENCE')), object_id TEXT NOT NULL,
 reason TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','RELEASED')),
 principal_id TEXT NOT NULL, authorization_id TEXT NOT NULL, created_at TEXT NOT NULL,
 released_at TEXT, released_by TEXT, released_authorization_id TEXT, release_reason TEXT,
 PRIMARY KEY(tenant_id,dependency_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id),
 FOREIGN KEY(tenant_id,dependent_work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE INDEX IF NOT EXISTS axiom_lc_holds_work ON axiom_lc_holds(tenant_id,work_id,state);
CREATE INDEX IF NOT EXISTS axiom_lc_dependencies_work ON axiom_lc_dependencies(tenant_id,work_id,state);
CREATE TABLE IF NOT EXISTS axiom_lc_exports(
 tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, work_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 snapshot_sha256 TEXT NOT NULL, export_sha256 TEXT NOT NULL,
 receipt_sha256 TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,request_id), UNIQUE(tenant_id,receipt_sha256),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_lc_delete_requests(
 tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, work_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 receipt_sha256 TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL, guard_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,request_id), UNIQUE(tenant_id,work_id), UNIQUE(tenant_id,receipt_sha256),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS axiom_lc_tombstones(
 tenant_id TEXT NOT NULL, work_id TEXT NOT NULL, object_kind TEXT NOT NULL, object_id TEXT NOT NULL,
 original_commitment_json TEXT NOT NULL, request_id TEXT NOT NULL, receipt_sha256 TEXT NOT NULL,
 erased_at TEXT NOT NULL, guard_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,object_kind,object_id),
 FOREIGN KEY(tenant_id,work_id) REFERENCES axiom_ec_works(tenant_id,work_id)
);
CREATE INDEX IF NOT EXISTS axiom_lc_tombstones_work ON axiom_lc_tombstones(tenant_id,work_id);
CREATE TABLE IF NOT EXISTS axiom_lc_audit(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, event_id TEXT NOT NULL,
 work_id TEXT NOT NULL, event_type TEXT NOT NULL, principal_id TEXT NOT NULL, authorization_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, previous_sha256 TEXT, event_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(tenant_id,event_id)
);
CREATE INDEX IF NOT EXISTS axiom_lc_audit_tenant ON axiom_lc_audit(tenant_id,sequence);
-- Guards hold raw comparison values only inside a single atomic batch; cleanup
-- removes them in the same transaction. They are never a retained export copy.
CREATE TABLE IF NOT EXISTS axiom_lc_guards(
 tenant_id TEXT NOT NULL, guard_id TEXT NOT NULL, work_id TEXT NOT NULL, action TEXT NOT NULL,
 principal_id TEXT NOT NULL, authorization_id TEXT NOT NULL, created_at TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL, export_receipt_sha256 TEXT,
 PRIMARY KEY(tenant_id,guard_id)
);
CREATE TRIGGER IF NOT EXISTS axiom_lc_guard_snapshot BEFORE INSERT ON axiom_lc_guards
WHEN NOT json_valid(NEW.snapshot_json) OR json_type(NEW.snapshot_json)!='object'
 OR NOT EXISTS(SELECT 1 FROM axiom_lc_authorizations a WHERE a.tenant_id=NEW.tenant_id
  AND a.authorization_id=NEW.authorization_id AND a.principal_id=NEW.principal_id
  AND a.work_id=NEW.work_id AND a.action=NEW.action AND a.state='ACTIVE'
  AND julianday(a.expires_at)>julianday(NEW.created_at))
 OR NOT EXISTS(SELECT 1 FROM axiom_ec_works w WHERE w.tenant_id=NEW.tenant_id AND w.work_id=NEW.work_id)
 OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.work_id=NEW.work_id AND t.object_kind='WORK')
 OR json_type(NEW.snapshot_json,'$.works') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_works r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.works')
 OR EXISTS(SELECT r.tenant_id,r.work_id,r.project_id,r.agent_id,r.request_sha256,r.contract_sha256,r.contract_json,r.state,r.expires_at,r.max_compute_calls,r.max_provider_calls,r.compute_calls,r.provider_calls FROM axiom_ec_works r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.project_id'),json_extract(s.value,'$.agent_id'),json_extract(s.value,'$.request_sha256'),json_extract(s.value,'$.contract_sha256'),json_extract(s.value,'$.contract_json'),json_extract(s.value,'$.state'),json_extract(s.value,'$.expires_at'),json_extract(s.value,'$.max_compute_calls'),json_extract(s.value,'$.max_provider_calls'),json_extract(s.value,'$.compute_calls'),json_extract(s.value,'$.provider_calls') FROM json_each(NEW.snapshot_json,'$.works') s)
 OR json_type(NEW.snapshot_json,'$.projects') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_projects r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=(SELECT project_id FROM axiom_ec_works WHERE tenant_id=NEW.tenant_id AND work_id=NEW.work_id))!=json_array_length(NEW.snapshot_json,'$.projects')
 OR EXISTS(SELECT r.tenant_id,r.project_id,r.state FROM axiom_ec_projects r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=(SELECT project_id FROM axiom_ec_works WHERE tenant_id=NEW.tenant_id AND work_id=NEW.work_id)
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.project_id'),json_extract(s.value,'$.state') FROM json_each(NEW.snapshot_json,'$.projects') s)
 OR json_type(NEW.snapshot_json,'$.agents') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_agents r WHERE r.tenant_id=NEW.tenant_id AND r.agent_id=(SELECT agent_id FROM axiom_ec_works WHERE tenant_id=NEW.tenant_id AND work_id=NEW.work_id))!=json_array_length(NEW.snapshot_json,'$.agents')
 OR EXISTS(SELECT r.tenant_id,r.agent_id,r.state FROM axiom_ec_agents r WHERE r.tenant_id=NEW.tenant_id AND r.agent_id=(SELECT agent_id FROM axiom_ec_works WHERE tenant_id=NEW.tenant_id AND work_id=NEW.work_id)
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.agent_id'),json_extract(s.value,'$.state') FROM json_each(NEW.snapshot_json,'$.agents') s)
 OR json_type(NEW.snapshot_json,'$.runs') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.runs')
 OR EXISTS(SELECT r.tenant_id,r.task_id,r.work_id,r.contract_sha256,r.status,r.binding_id,r.generation,r.lease_expires_at,r.started_at,r.completed_at,r.result_json FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.contract_sha256'),json_extract(s.value,'$.status'),json_extract(s.value,'$.binding_id'),json_extract(s.value,'$.generation'),json_extract(s.value,'$.lease_expires_at'),json_extract(s.value,'$.started_at'),json_extract(s.value,'$.completed_at'),json_extract(s.value,'$.result_json') FROM json_each(NEW.snapshot_json,'$.runs') s)
 OR json_type(NEW.snapshot_json,'$.artifacts') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_artifacts r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.artifacts')
 OR EXISTS(SELECT r.tenant_id,r.artifact_id,r.task_id,r.work_id,r.content_sha256,r.content_json,r.binding_id,r.generation,r.created_at FROM axiom_ec_artifacts r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.artifact_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.content_sha256'),json_extract(s.value,'$.content_json'),json_extract(s.value,'$.binding_id'),json_extract(s.value,'$.generation'),json_extract(s.value,'$.created_at') FROM json_each(NEW.snapshot_json,'$.artifacts') s)
 OR json_type(NEW.snapshot_json,'$.evidence') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_evidence r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_artifacts a WHERE a.tenant_id=r.tenant_id AND a.artifact_id=r.artifact_id AND a.work_id=NEW.work_id))!=json_array_length(NEW.snapshot_json,'$.evidence')
 OR EXISTS(SELECT r.tenant_id,r.evidence_id,r.artifact_id,r.kind,r.content_sha256,r.content_json FROM axiom_ec_evidence r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_artifacts a WHERE a.tenant_id=r.tenant_id AND a.artifact_id=r.artifact_id AND a.work_id=NEW.work_id)
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.evidence_id'),json_extract(s.value,'$.artifact_id'),json_extract(s.value,'$.kind'),json_extract(s.value,'$.content_sha256'),json_extract(s.value,'$.content_json') FROM json_each(NEW.snapshot_json,'$.evidence') s)
 OR json_type(NEW.snapshot_json,'$.reservations') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_reservations r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.reservations')
 OR EXISTS(SELECT r.tenant_id,r.reservation_id,r.work_id,r.task_id,r.binding_id,r.generation,r.action_kind,r.operation,r.compute_calls,r.provider_calls,r.created_at FROM axiom_ec_reservations r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.reservation_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.binding_id'),json_extract(s.value,'$.generation'),json_extract(s.value,'$.action_kind'),json_extract(s.value,'$.operation'),json_extract(s.value,'$.compute_calls'),json_extract(s.value,'$.provider_calls'),json_extract(s.value,'$.created_at') FROM json_each(NEW.snapshot_json,'$.reservations') s)
 OR json_type(NEW.snapshot_json,'$.invocations') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_agent_invocations r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.invocations')
 OR EXISTS(SELECT r.tenant_id,r.invocation_id,r.task_id,r.work_id,r.contract_sha256,r.reservation_id,r.binding_id,r.generation,r.stage,r.provider,r.model,r.request_sha256,r.status,r.session_id,r.turn_id,r.output_json,r.output_sha256,r.error_code,r.reconcile_reads,r.created_at,r.updated_at FROM axiom_ec_agent_invocations r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.invocation_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.contract_sha256'),json_extract(s.value,'$.reservation_id'),json_extract(s.value,'$.binding_id'),json_extract(s.value,'$.generation'),json_extract(s.value,'$.stage'),json_extract(s.value,'$.provider'),json_extract(s.value,'$.model'),json_extract(s.value,'$.request_sha256'),json_extract(s.value,'$.status'),json_extract(s.value,'$.session_id'),json_extract(s.value,'$.turn_id'),json_extract(s.value,'$.output_json'),json_extract(s.value,'$.output_sha256'),json_extract(s.value,'$.error_code'),json_extract(s.value,'$.reconcile_reads'),json_extract(s.value,'$.created_at'),json_extract(s.value,'$.updated_at') FROM json_each(NEW.snapshot_json,'$.invocations') s)
 OR json_type(NEW.snapshot_json,'$.completion_guards') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_agent_completion_guards r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_runs z WHERE z.tenant_id=r.tenant_id AND z.task_id=r.task_id AND z.work_id=NEW.work_id))!=json_array_length(NEW.snapshot_json,'$.completion_guards')
 OR EXISTS(SELECT r.tenant_id,r.task_id,r.snapshot_json FROM axiom_ec_agent_completion_guards r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_runs z WHERE z.tenant_id=r.tenant_id AND z.task_id=r.task_id AND z.work_id=NEW.work_id)
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.snapshot_json') FROM json_each(NEW.snapshot_json,'$.completion_guards') s)
 OR json_type(NEW.snapshot_json,'$.holds') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_lc_holds r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.holds')
 OR EXISTS(SELECT r.tenant_id,r.hold_id,r.work_id,r.object_kind,r.object_id,r.reason,r.state,r.principal_id,r.authorization_id,r.created_at,r.released_at,r.released_by,r.released_authorization_id,r.release_reason FROM axiom_lc_holds r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.hold_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.object_kind'),json_extract(s.value,'$.object_id'),json_extract(s.value,'$.reason'),json_extract(s.value,'$.state'),json_extract(s.value,'$.principal_id'),json_extract(s.value,'$.authorization_id'),json_extract(s.value,'$.created_at'),json_extract(s.value,'$.released_at'),json_extract(s.value,'$.released_by'),json_extract(s.value,'$.released_authorization_id'),json_extract(s.value,'$.release_reason') FROM json_each(NEW.snapshot_json,'$.holds') s)
 OR json_type(NEW.snapshot_json,'$.dependencies') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_lc_dependencies r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.dependencies')
 OR EXISTS(SELECT r.tenant_id,r.dependency_id,r.work_id,r.dependent_work_id,r.object_kind,r.object_id,r.reason,r.state,r.principal_id,r.authorization_id,r.created_at,r.released_at,r.released_by,r.released_authorization_id,r.release_reason FROM axiom_lc_dependencies r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.dependency_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.dependent_work_id'),json_extract(s.value,'$.object_kind'),json_extract(s.value,'$.object_id'),json_extract(s.value,'$.reason'),json_extract(s.value,'$.state'),json_extract(s.value,'$.principal_id'),json_extract(s.value,'$.authorization_id'),json_extract(s.value,'$.created_at'),json_extract(s.value,'$.released_at'),json_extract(s.value,'$.released_by'),json_extract(s.value,'$.released_authorization_id'),json_extract(s.value,'$.release_reason') FROM json_each(NEW.snapshot_json,'$.dependencies') s)
 OR (NEW.action='lifecycle.delete' AND (
  EXISTS(SELECT 1 FROM axiom_lc_holds h WHERE h.tenant_id=NEW.tenant_id AND h.work_id=NEW.work_id AND h.state='ACTIVE')
  OR EXISTS(SELECT 1 FROM axiom_lc_dependencies d WHERE d.tenant_id=NEW.tenant_id AND d.work_id=NEW.work_id AND d.dependent_work_id!=NEW.work_id AND d.state='ACTIVE')
  OR EXISTS(SELECT 1 FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id AND r.status='RUNNING')
  OR EXISTS(SELECT 1 FROM axiom_ec_agent_invocations i WHERE i.tenant_id=NEW.tenant_id AND i.work_id=NEW.work_id AND i.status!='SUCCEEDED' AND NOT COALESCE(
    i.status='UNCERTAIN' AND i.error_code IN('HOSTED_TURN_FAILED','HOSTED_TURN_CANCELLED')
    AND i.output_json IS NULL AND i.output_sha256 IS NULL
    AND i.session_id IS NOT NULL AND length(i.session_id) BETWEEN 1 AND 200 AND i.session_id NOT GLOB '*[^A-Za-z0-9_-]*'
    AND i.turn_id IS NOT NULL AND length(i.turn_id) BETWEEN 1 AND 200 AND i.turn_id NOT GLOB '*[^A-Za-z0-9_-]*'
    AND EXISTS(SELECT 1 FROM axiom_ec_runs r WHERE r.tenant_id=i.tenant_id AND r.task_id=i.task_id AND r.work_id=i.work_id AND r.status='FAILED'),0))
  OR NOT EXISTS(SELECT 1 FROM axiom_lc_exports e WHERE e.tenant_id=NEW.tenant_id AND e.work_id=NEW.work_id
   AND e.receipt_sha256=NEW.export_receipt_sha256 AND e.snapshot_sha256=NEW.snapshot_sha256)
 ))
BEGIN SELECT RAISE(ABORT,'lifecycle snapshot, legal hold, dependency or authority changed'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_audit_append BEFORE INSERT ON axiom_lc_audit
WHEN NEW.previous_sha256 IS NOT (SELECT event_sha256 FROM axiom_lc_audit WHERE tenant_id=NEW.tenant_id ORDER BY sequence DESC LIMIT 1)
BEGIN SELECT RAISE(ABORT,'lifecycle audit head changed'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_tombstone_guard BEFORE INSERT ON axiom_lc_tombstones
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.guard_id=NEW.guard_id AND g.action='lifecycle.delete')
BEGIN SELECT RAISE(ABORT,'lifecycle tombstone requires atomic authorized deletion'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_delete_final BEFORE INSERT ON axiom_lc_delete_requests
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.guard_id=NEW.guard_id AND g.action='lifecycle.delete'
 AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
 OR EXISTS(SELECT 1 FROM axiom_lc_holds h WHERE h.tenant_id=NEW.tenant_id AND h.work_id=NEW.work_id AND h.state='ACTIVE')
 OR EXISTS(SELECT 1 FROM axiom_lc_dependencies d WHERE d.tenant_id=NEW.tenant_id AND d.work_id=NEW.work_id AND d.dependent_work_id!=NEW.work_id AND d.state='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM axiom_ec_works w WHERE w.tenant_id=NEW.tenant_id AND w.work_id=NEW.work_id AND w.state='REVOKED' AND json_extract(w.contract_json,'$.receipt_sha256')=NEW.receipt_sha256)
 OR EXISTS(SELECT 1 FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id AND (r.status='RUNNING' OR json_extract(r.result_json,'$.receipt_sha256') IS NOT NEW.receipt_sha256))
 OR EXISTS(SELECT 1 FROM axiom_ec_artifacts r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id AND json_extract(r.content_json,'$.receipt_sha256') IS NOT NEW.receipt_sha256)
 OR EXISTS(SELECT 1 FROM axiom_ec_evidence r JOIN axiom_ec_artifacts a ON a.tenant_id=r.tenant_id AND a.artifact_id=r.artifact_id WHERE r.tenant_id=NEW.tenant_id AND a.work_id=NEW.work_id AND json_extract(r.content_json,'$.receipt_sha256') IS NOT NEW.receipt_sha256)
 OR EXISTS(SELECT 1 FROM axiom_ec_agent_invocations i WHERE i.tenant_id=NEW.tenant_id AND i.work_id=NEW.work_id AND (i.output_json IS NOT NULL OR i.session_id IS NOT NULL OR i.turn_id IS NOT NULL))
 OR NOT EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.work_id=NEW.work_id AND t.object_kind='WORK' AND t.receipt_sha256=NEW.receipt_sha256)
BEGIN SELECT RAISE(ABORT,'lifecycle erasure finalization failed'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_hold_target BEFORE INSERT ON axiom_lc_holds
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.work_id=NEW.work_id AND t.object_kind='WORK')
 OR (NEW.object_kind='WORK' AND NEW.object_id!=NEW.work_id)
 OR (NEW.object_kind='ARTIFACT' AND NOT EXISTS(SELECT 1 FROM axiom_ec_artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.work_id=NEW.work_id AND a.artifact_id=NEW.object_id))
 OR (NEW.object_kind='EVIDENCE' AND NOT EXISTS(SELECT 1 FROM axiom_ec_evidence e JOIN axiom_ec_artifacts a ON a.tenant_id=e.tenant_id AND a.artifact_id=e.artifact_id WHERE e.tenant_id=NEW.tenant_id AND a.work_id=NEW.work_id AND e.evidence_id=NEW.object_id))
BEGIN SELECT RAISE(ABORT,'lifecycle object not found'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_dependency_target BEFORE INSERT ON axiom_lc_dependencies
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND (t.work_id=NEW.work_id OR t.work_id=NEW.dependent_work_id) AND t.object_kind='WORK')
 OR (NEW.object_kind='WORK' AND NEW.object_id!=NEW.work_id)
 OR (NEW.object_kind='ARTIFACT' AND NOT EXISTS(SELECT 1 FROM axiom_ec_artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.work_id=NEW.work_id AND a.artifact_id=NEW.object_id))
 OR (NEW.object_kind='EVIDENCE' AND NOT EXISTS(SELECT 1 FROM axiom_ec_evidence e JOIN axiom_ec_artifacts a ON a.tenant_id=e.tenant_id AND a.artifact_id=e.artifact_id WHERE e.tenant_id=NEW.tenant_id AND a.work_id=NEW.work_id AND e.evidence_id=NEW.object_id))
BEGIN SELECT RAISE(ABORT,'lifecycle object not found'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_exports_immutable_update BEFORE UPDATE ON axiom_lc_exports
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_exports_immutable_delete BEFORE DELETE ON axiom_lc_exports
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_delete_requests_immutable_update BEFORE UPDATE ON axiom_lc_delete_requests
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_delete_requests_immutable_delete BEFORE DELETE ON axiom_lc_delete_requests
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_tombstones_immutable_update BEFORE UPDATE ON axiom_lc_tombstones
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_tombstones_immutable_delete BEFORE DELETE ON axiom_lc_tombstones
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_audit_immutable_update BEFORE UPDATE ON axiom_lc_audit
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_audit_immutable_delete BEFORE DELETE ON axiom_lc_audit
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_schema_immutable_update BEFORE UPDATE ON axiom_lc_schema
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_schema_immutable_delete BEFORE DELETE ON axiom_lc_schema
BEGIN SELECT RAISE(ABORT,'lifecycle proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_holds_no_delete BEFORE DELETE ON axiom_lc_holds
BEGIN SELECT RAISE(ABORT,'lifecycle hold/dependency history is retained'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_holds_release_only BEFORE UPDATE ON axiom_lc_holds
WHEN OLD.state!='ACTIVE' OR NEW.state!='RELEASED' OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.hold_id IS NOT OLD.hold_id OR NEW.work_id IS NOT OLD.work_id OR NEW.object_kind IS NOT OLD.object_kind OR NEW.object_id IS NOT OLD.object_id OR NEW.reason IS NOT OLD.reason OR NEW.principal_id IS NOT OLD.principal_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.created_at IS NOT OLD.created_at OR NEW.released_at IS NULL OR NEW.released_by IS NULL OR NEW.released_authorization_id IS NULL OR NEW.release_reason IS NULL
BEGIN SELECT RAISE(ABORT,'lifecycle history can only be explicitly released'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_dependencies_no_delete BEFORE DELETE ON axiom_lc_dependencies
BEGIN SELECT RAISE(ABORT,'lifecycle hold/dependency history is retained'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_dependencies_release_only BEFORE UPDATE ON axiom_lc_dependencies
WHEN OLD.state!='ACTIVE' OR NEW.state!='RELEASED' OR NEW.dependent_work_id IS NOT OLD.dependent_work_id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.dependency_id IS NOT OLD.dependency_id OR NEW.work_id IS NOT OLD.work_id OR NEW.object_kind IS NOT OLD.object_kind OR NEW.object_id IS NOT OLD.object_id OR NEW.reason IS NOT OLD.reason OR NEW.principal_id IS NOT OLD.principal_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.created_at IS NOT OLD.created_at OR NEW.released_at IS NULL OR NEW.released_by IS NULL OR NEW.released_authorization_id IS NULL OR NEW.release_reason IS NULL
BEGIN SELECT RAISE(ABORT,'lifecycle history can only be explicitly released'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_works_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_works
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_works_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_works
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_works_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_works
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_runs_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_runs
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_runs_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_runs
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_runs_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_runs
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_artifacts_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_artifacts
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_artifacts_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_artifacts
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_artifacts_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_artifacts
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_evidence_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_evidence
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.artifact_id=NEW.artifact_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_evidence_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_evidence
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_artifacts a WHERE a.tenant_id=OLD.tenant_id AND a.artifact_id=OLD.artifact_id)) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_artifacts a WHERE a.tenant_id=NEW.tenant_id AND a.artifact_id=NEW.artifact_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_evidence_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_evidence
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_artifacts a WHERE a.tenant_id=OLD.tenant_id AND a.artifact_id=OLD.artifact_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_reservations_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_reservations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_reservations_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_reservations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_reservations_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_reservations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_invocations_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_agent_invocations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_invocations_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_agent_invocations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_invocations_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_agent_invocations
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=OLD.work_id)
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_completion_guards_lifecycle_frozen_insert BEFORE INSERT ON axiom_ec_agent_completion_guards
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.task_id=NEW.task_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_completion_guards_lifecycle_frozen_update BEFORE UPDATE ON axiom_ec_agent_completion_guards
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_runs r WHERE r.tenant_id=OLD.tenant_id AND r.task_id=OLD.task_id)) OR EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=NEW.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_runs r WHERE r.tenant_id=NEW.tenant_id AND r.task_id=NEW.task_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_ec_agent_completion_guards_lifecycle_frozen_delete BEFORE DELETE ON axiom_ec_agent_completion_guards
WHEN EXISTS(SELECT 1 FROM axiom_lc_tombstones t WHERE t.tenant_id=OLD.tenant_id AND t.object_kind='WORK' AND t.work_id=(SELECT work_id FROM axiom_ec_runs r WHERE r.tenant_id=OLD.tenant_id AND r.task_id=OLD.task_id))
BEGIN SELECT RAISE(ABORT,'erased Work cannot be changed or resurrected'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_holds_authorized_insert BEFORE INSERT ON axiom_lc_holds
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.action='lifecycle.hold' AND g.principal_id=NEW.principal_id AND g.authorization_id=NEW.authorization_id
 AND g.created_at=NEW.created_at AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
BEGIN SELECT RAISE(ABORT,'lifecycle hold requires explicit atomic owner authorization'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_holds_authorized_update BEFORE UPDATE ON axiom_lc_holds
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.action='lifecycle.hold' AND g.principal_id=NEW.released_by AND g.authorization_id=NEW.released_authorization_id
 AND g.created_at=NEW.released_at AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
BEGIN SELECT RAISE(ABORT,'lifecycle hold requires explicit atomic owner authorization'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_dependencies_authorized_insert BEFORE INSERT ON axiom_lc_dependencies
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.action='lifecycle.dependency' AND g.principal_id=NEW.principal_id AND g.authorization_id=NEW.authorization_id
 AND g.created_at=NEW.created_at AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
BEGIN SELECT RAISE(ABORT,'lifecycle dependency requires explicit atomic owner authorization'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_dependencies_authorized_update BEFORE UPDATE ON axiom_lc_dependencies
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.action='lifecycle.dependency' AND g.principal_id=NEW.released_by AND g.authorization_id=NEW.released_authorization_id
 AND g.created_at=NEW.released_at AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
BEGIN SELECT RAISE(ABORT,'lifecycle dependency requires explicit atomic owner authorization'); END;
CREATE TRIGGER IF NOT EXISTS axiom_lc_export_authorized BEFORE INSERT ON axiom_lc_exports
WHEN NOT EXISTS(SELECT 1 FROM axiom_lc_guards g JOIN axiom_lc_authorizations a ON a.tenant_id=g.tenant_id AND a.authorization_id=g.authorization_id
 WHERE g.tenant_id=NEW.tenant_id AND g.work_id=NEW.work_id AND g.action='lifecycle.export' AND g.snapshot_sha256=NEW.snapshot_sha256
 AND g.principal_id=json_extract(NEW.receipt_json,'$.principal_id') AND g.authorization_id=json_extract(NEW.receipt_json,'$.authorization_id')
 AND g.created_at=NEW.created_at AND a.work_id=g.work_id AND a.action=g.action AND a.principal_id=g.principal_id AND a.state='ACTIVE' AND julianday(a.expires_at)>julianday(g.created_at))
BEGIN SELECT RAISE(ABORT,'lifecycle export requires explicit atomic owner authorization'); END;

-- Commitment-only external records are retained during logical payload erasure.
CREATE TRIGGER IF NOT EXISTS axiom_lc_guard_external_snapshot BEFORE INSERT ON axiom_lc_guards
WHEN
 json_type(NEW.snapshot_json,'$.external_consumptions') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_external_consumptions r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id)!=json_array_length(NEW.snapshot_json,'$.external_consumptions')
 OR EXISTS(SELECT r.tenant_id,r.reservation_id,r.work_id,r.task_id,r.ledger_id,r.grant_id,r.status,r.request_json,r.envelope_json FROM axiom_ec_external_consumptions r WHERE r.tenant_id=NEW.tenant_id AND r.work_id=NEW.work_id
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.reservation_id'),json_extract(s.value,'$.work_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.ledger_id'),json_extract(s.value,'$.grant_id'),json_extract(s.value,'$.status'),json_extract(s.value,'$.request_json'),json_extract(s.value,'$.envelope_json') FROM json_each(NEW.snapshot_json,'$.external_consumptions') s)
 OR json_type(NEW.snapshot_json,'$.external_guards') IS NOT 'array'
 OR (SELECT COUNT(*) FROM axiom_ec_external_completion_guards r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_runs z WHERE z.tenant_id=r.tenant_id AND z.task_id=r.task_id AND z.work_id=NEW.work_id))!=json_array_length(NEW.snapshot_json,'$.external_guards')
 OR EXISTS(SELECT r.tenant_id,r.task_id,r.snapshot_json FROM axiom_ec_external_completion_guards r WHERE r.tenant_id=NEW.tenant_id AND EXISTS(SELECT 1 FROM axiom_ec_runs z WHERE z.tenant_id=r.tenant_id AND z.task_id=r.task_id AND z.work_id=NEW.work_id)
  EXCEPT SELECT json_extract(s.value,'$.tenant_id'),json_extract(s.value,'$.task_id'),json_extract(s.value,'$.snapshot_json') FROM json_each(NEW.snapshot_json,'$.external_guards') s)
BEGIN SELECT RAISE(ABORT,'external authority set changed during lifecycle mutation'); END;
