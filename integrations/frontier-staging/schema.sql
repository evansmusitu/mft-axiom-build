-- OPERATOR-REVIEWED DISPOSABLE D1 ONLY. No request handler applies migrations.
-- There is deliberately NO default identity row. An empty/mismatched marker HOLDS.
CREATE TABLE frontier_stage_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 account_id TEXT NOT NULL,
 database_id TEXT NOT NULL,
 scope_nonce TEXT NOT NULL
);
CREATE TABLE frontier_stage_records (
 scope_nonce TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 record_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 payload_json TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL,
 PRIMARY KEY(scope_nonce,tenant_id,record_id)
);
CREATE TABLE frontier_stage_revocations (
 scope_nonce TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 token_sha256 TEXT NOT NULL,
 PRIMARY KEY(scope_nonce,tenant_id,token_sha256)
);
