-- S1 isolated, additive D1 migration candidate. STAGING REVIEW ONLY.
-- Install AFTER existing OAuth token tables and keyless_customer_link_candidate.sql.
-- A mapping is a binding of verified IdP principal to an existing canonical customer.
-- These tables must never be populated from client-supplied identity claims.
CREATE TABLE IF NOT EXISTS oauth_identity_code_links (
 code_hash TEXT PRIMARY KEY NOT NULL REFERENCES oauth_authorization_codes(code_hash),
 issuer TEXT NOT NULL,subject_sha256 TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 tenant_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(issuer,subject_sha256) REFERENCES oauth_identity_links(issuer,subject_sha256)
);
CREATE TABLE IF NOT EXISTS oauth_identity_token_links (
 api_key_id TEXT PRIMARY KEY NOT NULL REFERENCES api_keys(id),
 issuer TEXT NOT NULL,subject_sha256 TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 tenant_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(issuer,subject_sha256) REFERENCES oauth_identity_links(issuer,subject_sha256)
);
CREATE INDEX IF NOT EXISTS oauth_identity_token_links_customer ON oauth_identity_token_links(customer_id);
CREATE TRIGGER IF NOT EXISTS oauth_code_link_requires_active_identity BEFORE INSERT ON oauth_identity_code_links
WHEN NOT EXISTS (SELECT 1 FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 JOIN oauth_authorization_codes a ON a.code_hash=NEW.code_hash AND a.customer_id=l.customer_id
 WHERE l.issuer=NEW.issuer AND l.subject_sha256=NEW.subject_sha256 AND l.customer_id=NEW.customer_id
 AND l.tenant_id=NEW.tenant_id AND l.state='active' AND c.status='active')
BEGIN SELECT RAISE(ABORT,'identity_code_link_not_active'); END;
CREATE TRIGGER IF NOT EXISTS oauth_token_link_requires_active_identity BEFORE INSERT ON oauth_identity_token_links
WHEN NOT EXISTS (SELECT 1 FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 JOIN api_keys k ON k.id=NEW.api_key_id AND k.customer_id=l.customer_id AND k.status='active'
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

CREATE TRIGGER IF NOT EXISTS oauth_identity_code_links_insert_conflict BEFORE INSERT ON oauth_identity_code_links
WHEN EXISTS(SELECT 1 FROM oauth_identity_code_links p WHERE p.code_hash=NEW.code_hash)
BEGIN SELECT RAISE(ABORT,'identity_link_insert_conflict'); END;

CREATE TRIGGER IF NOT EXISTS oauth_identity_token_links_insert_conflict BEFORE INSERT ON oauth_identity_token_links
WHEN EXISTS(SELECT 1 FROM oauth_identity_token_links p WHERE p.api_key_id=NEW.api_key_id)
BEGIN SELECT RAISE(ABORT,'identity_link_insert_conflict'); END;

-- Active eligibility is enforced inside the mint transaction, including legacy grants.
CREATE TRIGGER IF NOT EXISTS oauth_api_key_customer_active BEFORE INSERT ON api_keys
WHEN NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.status='active')
BEGIN SELECT RAISE(ABORT,'oauth_customer_not_active'); END;
CREATE TRIGGER IF NOT EXISTS oauth_api_key_reactivation_customer_active BEFORE UPDATE OF status,customer_id ON api_keys
WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.status='active')
BEGIN SELECT RAISE(ABORT,'oauth_customer_not_active'); END;

-- Child linkage stays coherent even if a privileged importer tries to rewrite
-- the referenced parent. REPLACE must be stopped before implicit deletion.
CREATE TRIGGER IF NOT EXISTS oauth_linked_key_parent_immutable BEFORE UPDATE OF id,customer_id ON api_keys
WHEN EXISTS(SELECT 1 FROM oauth_identity_token_links t WHERE t.api_key_id=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.customer_id IS NOT OLD.customer_id)
BEGIN SELECT RAISE(ABORT,'oauth_linked_parent_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_linked_code_parent_immutable BEFORE UPDATE OF code_hash,customer_id ON oauth_authorization_codes
WHEN EXISTS(SELECT 1 FROM oauth_identity_code_links t WHERE t.code_hash=OLD.code_hash)
 AND (NEW.code_hash IS NOT OLD.code_hash OR NEW.customer_id IS NOT OLD.customer_id)
BEGIN SELECT RAISE(ABORT,'oauth_linked_parent_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_linked_key_parent_replace_denied BEFORE INSERT ON api_keys
WHEN EXISTS(SELECT 1 FROM oauth_identity_token_links t WHERE t.api_key_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'oauth_linked_parent_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_linked_code_parent_replace_denied BEFORE INSERT ON oauth_authorization_codes
WHEN EXISTS(SELECT 1 FROM oauth_identity_code_links t WHERE t.code_hash=NEW.code_hash)
BEGIN SELECT RAISE(ABORT,'oauth_linked_parent_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_linked_key_revocation_terminal BEFORE UPDATE OF status ON api_keys
WHEN OLD.status='revoked' AND NEW.status='active'
 AND EXISTS(SELECT 1 FROM oauth_identity_token_links t WHERE t.api_key_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'oauth_linked_key_revocation_terminal'); END;
