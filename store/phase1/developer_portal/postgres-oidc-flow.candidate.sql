-- MUSITU Store V2 disposable PostgreSQL-only OIDC state ledger.
-- NOT APPROVED FOR LIVE NEON STAGING OR PRODUCTION.
-- Run after postgres-review-journal.candidate.sql created private schema.
BEGIN;
CREATE TABLE store_publisher_private.oidc_flows (
 state_digest TEXT PRIMARY KEY CHECK (state_digest ~ '^[a-f0-9]{64}$'),
 encrypted_record BYTEA NOT NULL CHECK (octet_length(encrypted_record) BETWEEN 30 AND 4096),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '6 minutes')
);
CREATE INDEX oidc_flows_expiry ON store_publisher_private.oidc_flows (expires_at);
-- The application submits only SHA256(state), AES256-GCM encrypted payload
-- and an absolute 5-minute expiry; never plain nonce or PKCE verifier.
REVOKE ALL ON store_publisher_private.oidc_flows FROM PUBLIC;
COMMIT;
