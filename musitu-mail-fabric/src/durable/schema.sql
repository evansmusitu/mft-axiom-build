-- MUST be provisioned in a separately authorized D1 database. No production mutations here.
CREATE TABLE IF NOT EXISTS mail_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED','SENDING','ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','OUTCOME_UNKNOWN','BLOCKED_BY_POLICY')),
  sealed_envelope TEXT,
  events_json TEXT NOT NULL,
  claim_token TEXT,
  lease_deadline INTEGER,
  provider_id TEXT,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  UNIQUE(tenant_id,idempotency_key)
) STRICT;
CREATE INDEX IF NOT EXISTS mail_messages_queue_idx ON mail_messages(state,created_ms);
CREATE INDEX IF NOT EXISTS mail_messages_lease_idx ON mail_messages(state,lease_deadline);

CREATE TABLE IF NOT EXISTS mail_suppressions (
 tenant_id TEXT NOT NULL,
 recipient_hmac TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,recipient_hmac)
) STRICT;
