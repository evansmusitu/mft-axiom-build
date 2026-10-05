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

CREATE INDEX IF NOT EXISTS support_cases_state_priority ON support_cases(state, priority, created_at);
CREATE INDEX IF NOT EXISTS support_case_events_case_sequence ON support_case_events(case_id, sequence);

CREATE TRIGGER IF NOT EXISTS support_case_event_no_update
BEFORE UPDATE ON support_case_events BEGIN SELECT RAISE(ABORT, 'support events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS support_case_event_no_delete
BEFORE DELETE ON support_case_events BEGIN SELECT RAISE(ABORT, 'support events are append-only'); END;
