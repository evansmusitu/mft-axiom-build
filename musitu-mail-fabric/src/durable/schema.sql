-- MUST be provisioned in a separately authorized D1 database. No production mutations here.
CREATE TABLE IF NOT EXISTS mail_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  recipient_hmac TEXT NOT NULL,
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

-- Authenticated delivery-provider observations: provider assertions, not inbox proof.
CREATE TABLE IF NOT EXISTS mail_provider_events (
 tenant_id TEXT NOT NULL,
 svix_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 provider_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('email.delivered','email.bounced','email.complained','email.delivery_delayed')),
 raw_sha256 TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,svix_id),
 FOREIGN KEY(message_id) REFERENCES mail_messages(message_id)
) STRICT;
CREATE INDEX IF NOT EXISTS mail_provider_events_lookup_idx ON mail_provider_events(tenant_id,message_id,created_ms);
CREATE INDEX IF NOT EXISTS mail_messages_provider_lookup_idx ON mail_messages(tenant_id,provider_id);
-- Provider IDs must uniquely identify one message per tenant, or attribution is unsafe.
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_unique_provider_idx ON mail_messages(tenant_id,provider_id) WHERE provider_id IS NOT NULL;

-- Explicit sender-ownership verification, tenant-scoped and expiring.
CREATE TABLE IF NOT EXISTS mail_sender_domains (
 tenant_id TEXT NOT NULL,
 domain TEXT NOT NULL,
 challenge_sha256 TEXT NOT NULL,
 challenge_expires_ms INTEGER NOT NULL,
 verified_until_ms INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('PENDING','VERIFIED','REVOKED')),
 updated_ms INTEGER NOT NULL,
 PRIMARY KEY (tenant_id,domain)
) STRICT;
