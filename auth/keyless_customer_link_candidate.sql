-- ISOLATED S1 CANDIDATE. Apply only to independently approved STAGING OAuth D1.
-- This migration belongs to the EXISTING OAuth/customer database, not the
-- separately proposed customer-portal database. No cross-database FK assumed.
-- Linking records must be independently approved/imported; NO public creation route.
CREATE TABLE IF NOT EXISTS oauth_identity_links (
  issuer TEXT NOT NULL,
  subject_sha256 TEXT NOT NULL CHECK(length(subject_sha256)=64),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  witness_sha256 TEXT NOT NULL CHECK(length(witness_sha256)=64),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  PRIMARY KEY(issuer,subject_sha256),
  UNIQUE(customer_id),
  CHECK((state='active' AND revoked_at IS NULL) OR (state='revoked' AND revoked_at IS NOT NULL))
);
CREATE TRIGGER IF NOT EXISTS oauth_identity_link_immutable_identity
BEFORE UPDATE OF issuer,subject_sha256,tenant_id,customer_id,witness_sha256,created_at
ON oauth_identity_links BEGIN SELECT RAISE(ABORT,'identity_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS oauth_identity_link_no_delete
BEFORE DELETE ON oauth_identity_links BEGIN SELECT RAISE(ABORT,'identity_link_deletion_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS oauth_identity_link_no_reactivation
BEFORE UPDATE OF state ON oauth_identity_links
WHEN OLD.state='revoked' AND NEW.state='active'
BEGIN SELECT RAISE(ABORT,'identity_link_reactivation_forbidden'); END;

-- Prevent SQLite REPLACE from bypassing terminal revocation.
CREATE TRIGGER IF NOT EXISTS oauth_identity_link_insert_conflict BEFORE INSERT ON oauth_identity_links
WHEN EXISTS(SELECT 1 FROM oauth_identity_links p WHERE (p.issuer=NEW.issuer AND p.subject_sha256=NEW.subject_sha256) OR p.customer_id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'identity_link_insert_conflict'); END;
