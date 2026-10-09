PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_cases (
  case_id TEXT PRIMARY KEY CHECK (case_id GLOB 'AX-*'),
  state TEXT NOT NULL CHECK (state IN ('NEW','TRIAGED','WAITING_FOR_CUSTOMER','IN_PROGRESS','MITIGATED','RESOLVED','CLOSED','DUPLICATE','REJECTED')),
  priority TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  surface TEXT NOT NULL,
  category TEXT NOT NULL,
  requester_ref TEXT,
  retention_class TEXT NOT NULL,
  human_approval_required INTEGER NOT NULL CHECK (human_approval_required IN (0,1)),
  recovery_hash TEXT NOT NULL CHECK (length(recovery_hash) = 64),
  public_json TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  last_event_hash TEXT NOT NULL CHECK (length(last_event_hash) = 64),
  closed_at TEXT,
  retention_expires_at TEXT,
  legal_hold_until TEXT,
  legal_hold_review_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  prior_event_hash TEXT,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('customer','internal')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_messages (
  message_id TEXT PRIMARY KEY CHECK (message_id GLOB 'AXM-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('CUSTOMER_MESSAGE','AGENT_REPLY','INTERNAL_NOTE','SYSTEM_EVENT')),
  actor TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('customer','internal')),
  encrypted_payload TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_assignments (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  assigned_operator_ref TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_approvals (
  approval_id TEXT PRIMARY KEY CHECK (approval_id GLOB 'AXA-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  proposer_ref TEXT NOT NULL,
  proposer_role TEXT NOT NULL,
  evidence_hashes_json TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_approval_decisions (
  decision_id TEXT PRIMARY KEY CHECK (decision_id GLOB 'AXD-*'),
  approval_id TEXT NOT NULL REFERENCES support_case_approvals(approval_id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  approver_ref TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_notification_outbox (
  notification_id TEXT PRIMARY KEY CHECK (notification_id GLOB 'AXN-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('operator','customer')),
  event_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_recovery_bindings (
  case_id TEXT PRIMARY KEY REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_access')),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_recovery_requests (
  request_id TEXT PRIMARY KEY CHECK (request_id GLOB 'AXQ-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_recovery_rotations (
  rotation_id TEXT PRIMARY KEY CHECK (rotation_id GLOB 'AXR-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  approval_id TEXT UNIQUE REFERENCES support_case_approvals(approval_id) ON DELETE RESTRICT,
  prior_recovery_hash TEXT NOT NULL CHECK (length(prior_recovery_hash) = 64),
  new_recovery_hash TEXT NOT NULL CHECK (length(new_recovery_hash) = 64),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_sla (
  case_id TEXT PRIMARY KEY REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  plan TEXT NOT NULL CHECK (plan IN ('COMMUNITY','STANDARD','BUSINESS','ENTERPRISE')),
  ack_due_at TEXT NOT NULL, update_due_at TEXT NOT NULL, resolve_target_at TEXT NOT NULL,
  acknowledged_at TEXT, last_meaningful_update_at TEXT, resolved_at TEXT,
  contractual INTEGER NOT NULL CHECK (contractual IN (0,1)), updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_escalations (
  escalation_id TEXT PRIMARY KEY CHECK (escalation_id GLOB 'AXE-*'),
  case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  lane TEXT NOT NULL, reason_code TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','CLOSED')),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash)=64), created_at TEXT NOT NULL, closed_at TEXT
);

CREATE TABLE IF NOT EXISTS support_incidents (
  incident_id TEXT PRIMARY KEY CHECK (incident_id GLOB 'AXI-*'), title TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  state TEXT NOT NULL CHECK (state IN ('INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED')), public_summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_incident_cases (
  incident_id TEXT NOT NULL REFERENCES support_incidents(incident_id) ON DELETE RESTRICT, case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  linked_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(incident_id,case_id)
);
CREATE TABLE IF NOT EXISTS support_status_updates (
  update_id TEXT PRIMARY KEY CHECK (update_id GLOB 'AXU-*'), incident_id TEXT NOT NULL REFERENCES support_incidents(incident_id) ON DELETE RESTRICT,
  state TEXT NOT NULL, public_message TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash)=64), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_organizations (
  org_ref TEXT PRIMARY KEY, plan TEXT NOT NULL CHECK (plan IN ('COMMUNITY','STANDARD','BUSINESS','ENTERPRISE')), status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_support_entitlements (
  entitlement_id TEXT PRIMARY KEY CHECK (entitlement_id GLOB 'AXT-*'), org_ref TEXT NOT NULL REFERENCES support_organizations(org_ref) ON DELETE RESTRICT,
  capability TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), starts_at TEXT NOT NULL, ends_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_attachments (
  attachment_id TEXT PRIMARY KEY CHECK (attachment_id GLOB 'AXF-*'), case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  filename TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  storage_key TEXT NOT NULL UNIQUE, scan_state TEXT NOT NULL CHECK(scan_state IN ('PENDING','CLEAN','QUARANTINED','FAILED')), visibility TEXT NOT NULL CHECK(visibility IN ('customer','internal')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_attachment_deletion_outbox (
  deletion_id TEXT PRIMARY KEY CHECK (deletion_id GLOB 'AXZ-*'),
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  state TEXT NOT NULL CHECK (state IN ('PENDING','RETRY','DELETED','DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS support_diagnostics (
  diagnostic_id TEXT PRIMARY KEY CHECK (diagnostic_id GLOB 'AXG-*'), case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  consented INTEGER NOT NULL CHECK(consented=1), metadata_json TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash)=64), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_webhook_subscriptions (
  webhook_ref TEXT PRIMARY KEY, org_ref TEXT REFERENCES support_organizations(org_ref) ON DELETE RESTRICT, endpoint_ref TEXT NOT NULL, secret_ref TEXT NOT NULL,
  event_types_json TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_webhook_delivery_configs (
  webhook_ref TEXT PRIMARY KEY REFERENCES support_webhook_subscriptions(webhook_ref) ON DELETE RESTRICT,
  config_encrypted TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_webhook_outbox (
  delivery_id TEXT PRIMARY KEY CHECK(delivery_id GLOB 'AXW-*'), webhook_ref TEXT NOT NULL REFERENCES support_webhook_subscriptions(webhook_ref) ON DELETE RESTRICT,
  case_id TEXT REFERENCES support_cases(case_id) ON DELETE RESTRICT, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, event_hash TEXT NOT NULL CHECK(length(event_hash)=64),
  state TEXT NOT NULL CHECK(state IN ('PENDING','DELIVERED','RETRY','DEAD')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, created_at TEXT NOT NULL, delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS support_notification_attempts (
  attempt_id TEXT PRIMARY KEY CHECK(attempt_id GLOB 'AXY-*'), notification_id TEXT NOT NULL REFERENCES support_notification_outbox(notification_id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK(channel IN ('email','webhook','pager')), state TEXT NOT NULL CHECK(state IN ('QUEUED','SENT','FAILED','RETRY')), provider_ref_hash TEXT, attempted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_email_threads (
  thread_ref TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT, address_hash TEXT NOT NULL CHECK(length(address_hash)=64),
  provider_thread_hash TEXT NOT NULL CHECK(length(provider_thread_hash)=64), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_operator_leases (
  case_id TEXT PRIMARY KEY REFERENCES support_cases(case_id) ON DELETE RESTRICT, operator_ref TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_case_handoffs (
  handoff_id TEXT PRIMARY KEY CHECK(handoff_id GLOB 'AXH-*'), case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT,
  from_ref TEXT NOT NULL, to_lane TEXT NOT NULL, note_encrypted TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash)=64), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_operator_macros (
  macro_id TEXT PRIMARY KEY CHECK(macro_id GLOB 'AXK-*'), owner_ref TEXT NOT NULL, name TEXT NOT NULL, body_encrypted TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_case_triage (
  case_id TEXT PRIMARY KEY REFERENCES support_cases(case_id) ON DELETE RESTRICT, lane TEXT NOT NULL, language TEXT NOT NULL, advisory_only INTEGER NOT NULL CHECK(advisory_only=1), human_review_required INTEGER NOT NULL CHECK(human_review_required=1), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_case_languages (
  case_id TEXT PRIMARY KEY REFERENCES support_cases(case_id) ON DELETE RESTRICT, language TEXT NOT NULL, detected_from TEXT NOT NULL CHECK(detected_from IN ('customer','browser','operator','unknown')), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_csat (
  response_id TEXT PRIMARY KEY CHECK(response_id GLOB 'AXC-*'), case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT, score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), reason_encrypted TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_qa_reviews (
  review_id TEXT PRIMARY KEY CHECK(review_id GLOB 'AXJ-*'), case_id TEXT NOT NULL REFERENCES support_cases(case_id) ON DELETE RESTRICT, reviewer_ref TEXT NOT NULL,
  quality INTEGER NOT NULL CHECK(quality BETWEEN 1 AND 5), policy INTEGER NOT NULL CHECK(policy BETWEEN 1 AND 5), accuracy INTEGER NOT NULL CHECK(accuracy BETWEEN 1 AND 5), notes_encrypted TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_case_purge_authorizations (
  case_id TEXT PRIMARY KEY CHECK (case_id GLOB 'AX-*'),
  receipt_sha256 TEXT NOT NULL CHECK (length(receipt_sha256) = 64),
  authorized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_deletion_receipts (
  receipt_sha256 TEXT PRIMARY KEY CHECK (length(receipt_sha256) = 64),
  case_reference_sha256 TEXT NOT NULL CHECK (length(case_reference_sha256) = 64),
  retention_class TEXT NOT NULL CHECK (retention_class IN ('SUPPORT_STANDARD','PRIVACY_RESTRICTED','SECURITY_RESTRICTED')),
  closed_at TEXT NOT NULL,
  retention_expires_at TEXT NOT NULL,
  purged_at TEXT NOT NULL,
  last_event_hash TEXT NOT NULL CHECK (length(last_event_hash) = 64),
  approval_evidence_hashes_json TEXT NOT NULL,
  processor_backup_expiry_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS support_case_escalations_case_created ON support_case_escalations(case_id,created_at);
CREATE INDEX IF NOT EXISTS support_incident_cases_case ON support_incident_cases(case_id,incident_id);
CREATE INDEX IF NOT EXISTS support_attachments_case_created ON support_attachments(case_id,created_at);
CREATE INDEX IF NOT EXISTS support_attachment_deletion_outbox_state_next ON support_attachment_deletion_outbox(state,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS support_webhook_outbox_state_next ON support_webhook_outbox(state,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS support_notification_attempts_notification ON support_notification_attempts(notification_id,attempted_at);
CREATE INDEX IF NOT EXISTS support_csat_case_created ON support_csat(case_id,created_at);
CREATE INDEX IF NOT EXISTS support_qa_reviews_case_created ON support_qa_reviews(case_id,created_at);

CREATE INDEX IF NOT EXISTS support_cases_state_priority ON support_cases(state, priority, created_at);
CREATE INDEX IF NOT EXISTS support_cases_retention ON support_cases(state, retention_expires_at, legal_hold_until);
CREATE INDEX IF NOT EXISTS support_deletion_receipts_purged_at ON support_deletion_receipts(purged_at);
CREATE INDEX IF NOT EXISTS support_case_events_case_sequence ON support_case_events(case_id, sequence);
CREATE INDEX IF NOT EXISTS support_case_messages_case_created ON support_case_messages(case_id, created_at);
CREATE INDEX IF NOT EXISTS support_case_assignments_case_created ON support_case_assignments(case_id, created_at);
CREATE INDEX IF NOT EXISTS support_case_approvals_case_created ON support_case_approvals(case_id, created_at);
CREATE INDEX IF NOT EXISTS support_notification_outbox_case_created ON support_notification_outbox(case_id, created_at);
CREATE INDEX IF NOT EXISTS support_case_recovery_requests_case_created ON support_case_recovery_requests(case_id, created_at);
CREATE INDEX IF NOT EXISTS support_case_recovery_rotations_case_created ON support_case_recovery_rotations(case_id, created_at);

CREATE TRIGGER IF NOT EXISTS support_case_escalation_no_update
BEFORE UPDATE ON support_case_escalations WHEN NEW.status=OLD.status BEGIN SELECT RAISE(ABORT,'support escalation history is append-first'); END;
CREATE TRIGGER IF NOT EXISTS support_attachment_no_delete
BEFORE DELETE ON support_attachments
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id=OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT,'support attachment metadata may be deleted only by an authorized case purge'); END;
CREATE TRIGGER IF NOT EXISTS support_diagnostic_no_update
BEFORE UPDATE ON support_diagnostics BEGIN SELECT RAISE(ABORT,'support diagnostics are immutable'); END;
CREATE TRIGGER IF NOT EXISTS support_csat_no_update
BEFORE UPDATE ON support_csat BEGIN SELECT RAISE(ABORT,'support CSAT is immutable'); END;
CREATE TRIGGER IF NOT EXISTS support_qa_review_no_update
BEFORE UPDATE ON support_qa_reviews BEGIN SELECT RAISE(ABORT,'support QA reviews are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_request_no_update
BEFORE UPDATE ON support_case_recovery_requests BEGIN SELECT RAISE(ABORT, 'support recovery requests are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_request_no_delete
BEFORE DELETE ON support_case_recovery_requests
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support recovery requests are immutable outside an authorized case purge'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_binding_no_update
BEFORE UPDATE ON support_case_recovery_bindings BEGIN SELECT RAISE(ABORT, 'support recovery identity bindings are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_binding_no_delete
BEFORE DELETE ON support_case_recovery_bindings
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support recovery identity bindings are immutable outside an authorized case purge'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_rotation_no_update
BEFORE UPDATE ON support_case_recovery_rotations BEGIN SELECT RAISE(ABORT, 'support recovery rotations are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_case_recovery_rotation_no_delete
BEFORE DELETE ON support_case_recovery_rotations
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support recovery rotations are immutable outside an authorized case purge'); END;

CREATE TRIGGER IF NOT EXISTS support_case_assignment_no_update
BEFORE UPDATE ON support_case_assignments BEGIN SELECT RAISE(ABORT, 'support assignments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS support_case_approval_no_update
BEFORE UPDATE ON support_case_approvals BEGIN SELECT RAISE(ABORT, 'support approval proposals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS support_case_approval_decision_no_update
BEFORE UPDATE ON support_case_approval_decisions BEGIN SELECT RAISE(ABORT, 'support approval decisions are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_case_message_no_update
BEFORE UPDATE ON support_case_messages BEGIN SELECT RAISE(ABORT, 'support messages are append-only'); END;

CREATE TRIGGER IF NOT EXISTS support_case_message_no_delete
BEFORE DELETE ON support_case_messages
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support messages are append-only outside an authorized case purge'); END;

CREATE TRIGGER IF NOT EXISTS support_case_event_no_update
BEFORE UPDATE ON support_case_events BEGIN SELECT RAISE(ABORT, 'support events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS support_case_event_no_delete
BEFORE DELETE ON support_case_events
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support events are append-only outside an authorized case purge'); END;

CREATE TRIGGER IF NOT EXISTS support_case_no_delete
BEFORE DELETE ON support_cases
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support cases may be deleted only by an authorized purge'); END;

CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_update
BEFORE UPDATE ON support_deletion_receipts BEGIN SELECT RAISE(ABORT, 'support deletion receipts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_delete
BEFORE DELETE ON support_deletion_receipts BEGIN SELECT RAISE(ABORT, 'support deletion receipts are immutable'); END;
