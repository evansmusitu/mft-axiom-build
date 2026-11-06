-- ADDITIVE OFFLINE CANDIDATE. Do not apply to staging/production without approval,
-- dirty-row preflight, backup/restore and independent migration acceptance.
-- References an EXISTING independently verified production customers.id; does
-- not create a customers table, merchant, subscription, entitlement or API key.
CREATE TABLE IF NOT EXISTS canonical_customer_links (
 identity_id TEXT PRIMARY KEY NOT NULL REFERENCES identities(id),
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 customer_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 link_kind TEXT NOT NULL CHECK(link_kind IN ('fresh','legacy')),
 proof_id TEXT NOT NULL UNIQUE,
 proof_sha256 TEXT NOT NULL CHECK(length(proof_sha256)=64),
 consent_id TEXT NOT NULL,
 authority_subject TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(tenant_id,identity_id) REFERENCES memberships(tenant_id,identity_id)
);
-- REPLACE may bypass implicit-delete triggers when recursive_triggers=0.
-- Reject the collision BEFORE SQLite can remove an existing/revoked record.
CREATE TRIGGER IF NOT EXISTS axiom_canonical_link_insert_conflict BEFORE INSERT ON canonical_customer_links
WHEN EXISTS(SELECT 1 FROM canonical_customer_links p WHERE p.identity_id=NEW.identity_id
 OR p.customer_id=NEW.customer_id OR p.proof_id=NEW.proof_id)
BEGIN SELECT RAISE(ABORT,'canonical_link_insert_conflict'); END;
CREATE TRIGGER IF NOT EXISTS axiom_canonical_link_immutable BEFORE UPDATE ON canonical_customer_links
WHEN OLD.identity_id IS NOT NEW.identity_id OR OLD.tenant_id IS NOT NEW.tenant_id
 OR OLD.customer_id IS NOT NEW.customer_id OR OLD.link_kind IS NOT NEW.link_kind
 OR OLD.proof_id IS NOT NEW.proof_id OR OLD.proof_sha256 IS NOT NEW.proof_sha256
 OR OLD.consent_id IS NOT NEW.consent_id OR OLD.authority_subject IS NOT NEW.authority_subject
 OR OLD.created_at IS NOT NEW.created_at
BEGIN SELECT RAISE(ABORT,'canonical_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_canonical_link_no_delete BEFORE DELETE ON canonical_customer_links
BEGIN SELECT RAISE(ABORT,'canonical_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS axiom_canonical_link_revocation_terminal BEFORE UPDATE OF status ON canonical_customer_links
WHEN OLD.status='revoked' AND NEW.status!='revoked'
BEGIN SELECT RAISE(ABORT,'canonical_link_revocation_terminal'); END;
