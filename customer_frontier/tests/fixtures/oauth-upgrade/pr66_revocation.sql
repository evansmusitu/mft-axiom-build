-- S1 isolated, additive D1 migration candidate. STAGING REVIEW ONLY.
-- Install AFTER existing OAuth token tables and keyless_customer_link_candidate.sql.
-- A mapping is a binding of verified IdP principal to an existing canonical customer.
-- These tables must never be populated from client-supplied identity claims.
CREATE TABLE IF NOT EXISTS oauth_identity_code_links (
 code_hash TEXT PRIMARY KEY REFERENCES oauth_authorization_codes(code_hash),
 issuer TEXT NOT NULL,subject_sha256 TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 tenant_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(issuer,subject_sha256) REFERENCES oauth_identity_links(issuer,subject_sha256)
);
CREATE TABLE IF NOT EXISTS oauth_identity_token_links (
 api_key_id TEXT PRIMARY KEY REFERENCES api_keys(id),
 issuer TEXT NOT NULL,subject_sha256 TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 tenant_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(issuer,subject_sha256) REFERENCES oauth_identity_links(issuer,subject_sha256)
);
CREATE INDEX IF NOT EXISTS oauth_identity_token_links_customer ON oauth_identity_token_links(customer_id);
CREATE TRIGGER IF NOT EXISTS oauth_code_link_requires_active_identity BEFORE INSERT ON oauth_identity_code_links
WHEN NOT EXISTS (SELECT 1 FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 WHERE l.issuer=NEW.issuer AND l.subject_sha256=NEW.subject_sha256 AND l.customer_id=NEW.customer_id
 AND l.tenant_id=NEW.tenant_id AND l.state='active' AND c.status='active')
BEGIN SELECT RAISE(ABORT,'identity_code_link_not_active'); END;
CREATE TRIGGER IF NOT EXISTS oauth_token_link_requires_active_identity BEFORE INSERT ON oauth_identity_token_links
WHEN NOT EXISTS (SELECT 1 FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 WHERE l.issuer=NEW.issuer AND l.subject_sha256=NEW.subject_sha256 AND l.customer_id=NEW.customer_id
 AND l.tenant_id=NEW.tenant_id AND l.state='active' AND c.status='active')
BEGIN SELECT RAISE(ABORT,'identity_token_link_not_active'); END;
CREATE TRIGGER IF NOT EXISTS oauth_code_link_immutable BEFORE UPDATE ON oauth_identity_code_links BEGIN SELECT RAISE(ABORT,'identity_code_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_code_link_nodelete BEFORE DELETE ON oauth_identity_code_links BEGIN SELECT RAISE(ABORT,'identity_code_link_nodelete'); END;
CREATE TRIGGER IF NOT EXISTS oauth_token_link_immutable BEFORE UPDATE ON oauth_identity_token_links BEGIN SELECT RAISE(ABORT,'identity_token_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_token_link_nodelete BEFORE DELETE ON oauth_identity_token_links BEGIN SELECT RAISE(ABORT,'identity_token_link_nodelete'); END;
-- Same D1 transaction revokes BOTH userinfo tokens and MCP api_keys.
CREATE TRIGGER IF NOT EXISTS oauth_identity_link_revokes_tokens AFTER UPDATE OF state ON oauth_identity_links
WHEN OLD.state='active' AND NEW.state='revoked'
BEGIN
 UPDATE oauth_access_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND api_key_id IN
 (SELECT api_key_id FROM oauth_identity_token_links WHERE issuer=NEW.issuer AND subject_sha256=NEW.subject_sha256);
 UPDATE oauth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND api_key_id IN
 (SELECT api_key_id FROM oauth_identity_token_links WHERE issuer=NEW.issuer AND subject_sha256=NEW.subject_sha256);
 UPDATE api_keys SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE status='active' AND id IN
 (SELECT api_key_id FROM oauth_identity_token_links WHERE issuer=NEW.issuer AND subject_sha256=NEW.subject_sha256);
END;
-- Canonical customer suspension prevents old/new tokens from continuing, including MCP keys.
CREATE TRIGGER IF NOT EXISTS oauth_customer_disabled_revokes_tokens AFTER UPDATE OF status ON customers
WHEN OLD.status='active' AND NEW.status!='active'
BEGIN
 UPDATE oauth_access_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND customer_id=NEW.id;
 UPDATE oauth_refresh_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL AND customer_id=NEW.id;
 UPDATE api_keys SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE status='active' AND customer_id=NEW.id;
END;
