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
