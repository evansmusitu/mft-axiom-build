-- LIFELINE owner-only synthetic status store; no trades, broker accounts or production data.
CREATE TABLE IF NOT EXISTS lifeline_alt_nonces(
  tenant TEXT NOT NULL, nonce TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant,nonce)
);
CREATE TABLE IF NOT EXISTS lifeline_alt_jobs(
  job_id TEXT PRIMARY KEY, tenant TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation='probe'),
  state TEXT NOT NULL CHECK(state IN ('PENDING','CLAIMED','COMPLETED')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeline_alt_jobs ON lifeline_alt_jobs(tenant,state);
