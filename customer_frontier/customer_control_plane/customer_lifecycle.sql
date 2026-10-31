-- Additive candidate D1/SQLite migration. Do not apply to production without reviewed migrations.
-- Requests are not execution grants. Privacy deletion is never automatic.
CREATE TABLE IF NOT EXISTS customer_cases (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 identity_id TEXT NOT NULL REFERENCES identities(id),
 client_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('support','privacy_export','privacy_delete')),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 4 AND 160),
 detail TEXT NOT NULL CHECK(length(detail) BETWEEN 8 AND 3000),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','under_review','resolved','denied')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,identity_id,client_key),
 FOREIGN KEY(tenant_id,identity_id) REFERENCES memberships(tenant_id,identity_id)
);
-- Exactly one outstanding rights request of each kind per identity prevents floods
-- without forcing users to exhaust a general-purpose support quota.
CREATE UNIQUE INDEX IF NOT EXISTS customer_cases_pending_right ON customer_cases(tenant_id,identity_id,kind)
 WHERE kind IN ('privacy_export','privacy_delete') AND status IN ('requested','under_review');
CREATE INDEX IF NOT EXISTS customer_cases_tenant_owner ON customer_cases(tenant_id,identity_id,created_at);
-- Preserve original user-submitted request; append independent decisions elsewhere.
CREATE TRIGGER IF NOT EXISTS customer_cases_no_delete BEFORE DELETE ON customer_cases BEGIN SELECT RAISE(ABORT,'customer_request_immutable'); END;
CREATE TRIGGER IF NOT EXISTS customer_cases_no_rewrite BEFORE UPDATE OF tenant_id,identity_id,client_key,kind,subject,detail,created_at ON customer_cases BEGIN SELECT RAISE(ABORT,'customer_request_immutable'); END;
