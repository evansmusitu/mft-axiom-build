-- MUSITU Axiom provider-neutral distribution OAuth state.
-- Deliberately separate from the frozen OpenAI OAuth namespace.

CREATE TABLE IF NOT EXISTS dist_oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uris_json TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dist_oauth_authorization_flows (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS dist_oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS dist_oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS dist_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dist_oauth_flows_expiry
  ON dist_oauth_authorization_flows(expires_at);
CREATE INDEX IF NOT EXISTS idx_dist_oauth_codes_client_expiry
  ON dist_oauth_authorization_codes(client_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_dist_oauth_access_customer_expiry
  ON dist_oauth_access_tokens(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_dist_oauth_access_api_key
  ON dist_oauth_access_tokens(api_key_id);
CREATE INDEX IF NOT EXISTS idx_dist_oauth_refresh_customer_expiry
  ON dist_oauth_refresh_tokens(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_dist_oauth_refresh_api_key
  ON dist_oauth_refresh_tokens(api_key_id);
