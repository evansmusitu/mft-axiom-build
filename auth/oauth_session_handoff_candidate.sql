-- NEW ISOLATED NAMESPACE ONLY. Review, backup and rehearse rollback before hosting.
-- Ownership decisions are independently imported; no browser/service write route.
-- Existing customer/canonical/OAuth tables are never modified by this migration.
CREATE TABLE oauth_handoff_ownership_v1 (
 issuer TEXT NOT NULL,subject_sha256 TEXT NOT NULL CHECK(length(subject_sha256)=64),
 tenant_id TEXT NOT NULL,customer_id TEXT NOT NULL,
 canonical_proof_sha256 TEXT NOT NULL CHECK(length(canonical_proof_sha256)=64),
 oauth_witness_sha256 TEXT NOT NULL CHECK(length(oauth_witness_sha256)=64),
 decision_id TEXT NOT NULL UNIQUE,acceptance_sha256 TEXT NOT NULL CHECK(length(acceptance_sha256)=64),
 accepted_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>accepted_at_ms),
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','revoked')),
 PRIMARY KEY(issuer,subject_sha256),UNIQUE(customer_id)
);
CREATE TRIGGER oauth_handoff_ownership_no_replace BEFORE INSERT ON oauth_handoff_ownership_v1
WHEN EXISTS(SELECT 1 FROM oauth_handoff_ownership_v1 WHERE (issuer=NEW.issuer AND subject_sha256=NEW.subject_sha256) OR customer_id=NEW.customer_id OR decision_id=NEW.decision_id)
BEGIN SELECT RAISE(ABORT,'ownership_replace_denied'); END;
CREATE TRIGGER oauth_handoff_ownership_immutable BEFORE UPDATE ON oauth_handoff_ownership_v1
WHEN NOT(OLD.status='accepted' AND NEW.status='revoked' AND OLD.issuer=NEW.issuer AND OLD.subject_sha256=NEW.subject_sha256
 AND OLD.tenant_id=NEW.tenant_id AND OLD.customer_id=NEW.customer_id AND OLD.canonical_proof_sha256=NEW.canonical_proof_sha256
 AND OLD.oauth_witness_sha256=NEW.oauth_witness_sha256 AND OLD.decision_id=NEW.decision_id AND OLD.acceptance_sha256=NEW.acceptance_sha256
 AND OLD.accepted_at_ms=NEW.accepted_at_ms AND OLD.expires_at_ms=NEW.expires_at_ms)
BEGIN SELECT RAISE(ABORT,'ownership_terminal'); END;
CREATE TRIGGER oauth_handoff_ownership_no_delete BEFORE DELETE ON oauth_handoff_ownership_v1
BEGIN SELECT RAISE(ABORT,'ownership_delete_denied'); END;
CREATE TABLE oauth_session_handoffs_v1 (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=43),flow_id TEXT NOT NULL UNIQUE,
 flow_sha256 TEXT NOT NULL CHECK(length(flow_sha256)=64),browser_sha256 TEXT NOT NULL CHECK(length(browser_sha256)=64),
 created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms AND expires_at_ms-created_at_ms<=300000),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','consent','approved','redeemed')),
 session_hash TEXT,session_version INTEGER,mapping_sha256 TEXT,consent_sha256 TEXT,grant_sha256 TEXT,
 approved_at_ms INTEGER,redeemed_at_ms INTEGER,
 CHECK((status='requested' AND session_hash IS NULL AND session_version IS NULL AND mapping_sha256 IS NULL AND consent_sha256 IS NULL AND grant_sha256 IS NULL AND approved_at_ms IS NULL AND redeemed_at_ms IS NULL)
 OR (status='consent' AND session_hash IS NOT NULL AND session_version IS NOT NULL AND mapping_sha256 IS NOT NULL AND consent_sha256 IS NOT NULL AND length(session_hash)=64 AND session_version>0 AND length(mapping_sha256)=64 AND length(consent_sha256)=64 AND grant_sha256 IS NULL AND approved_at_ms IS NULL AND redeemed_at_ms IS NULL)
 OR (status IN ('approved','redeemed') AND session_hash IS NOT NULL AND session_version IS NOT NULL AND mapping_sha256 IS NOT NULL AND consent_sha256 IS NOT NULL AND grant_sha256 IS NOT NULL AND approved_at_ms IS NOT NULL AND length(session_hash)=64 AND session_version>0 AND length(mapping_sha256)=64 AND length(consent_sha256)=64 AND length(grant_sha256)=64 AND approved_at_ms>=created_at_ms AND approved_at_ms<expires_at_ms AND
 ((status='approved' AND redeemed_at_ms IS NULL) OR (status='redeemed' AND redeemed_at_ms IS NOT NULL AND redeemed_at_ms>=approved_at_ms AND redeemed_at_ms<expires_at_ms))))
);
CREATE TRIGGER oauth_handoff_no_replace BEFORE INSERT ON oauth_session_handoffs_v1
WHEN EXISTS(SELECT 1 FROM oauth_session_handoffs_v1 WHERE id=NEW.id OR flow_id=NEW.flow_id)
BEGIN SELECT RAISE(ABORT,'handoff_replace_denied'); END;
CREATE TRIGGER oauth_handoff_initial BEFORE INSERT ON oauth_session_handoffs_v1 WHEN NEW.status!='requested'
BEGIN SELECT RAISE(ABORT,'handoff_initial_denied'); END;
CREATE TRIGGER oauth_handoff_transition BEFORE UPDATE ON oauth_session_handoffs_v1
WHEN NOT(OLD.id=NEW.id AND OLD.flow_id=NEW.flow_id AND OLD.flow_sha256=NEW.flow_sha256 AND OLD.browser_sha256=NEW.browser_sha256
 AND OLD.created_at_ms=NEW.created_at_ms AND OLD.expires_at_ms=NEW.expires_at_ms AND (
 (OLD.status='requested' AND NEW.status='consent') OR
 (OLD.status='consent' AND NEW.status='approved' AND OLD.session_hash=NEW.session_hash AND OLD.session_version=NEW.session_version
  AND OLD.mapping_sha256=NEW.mapping_sha256 AND OLD.consent_sha256=NEW.consent_sha256) OR
 (OLD.status='approved' AND NEW.status='redeemed' AND OLD.session_hash=NEW.session_hash AND OLD.session_version=NEW.session_version
  AND OLD.mapping_sha256=NEW.mapping_sha256 AND OLD.consent_sha256=NEW.consent_sha256 AND OLD.grant_sha256=NEW.grant_sha256 AND OLD.approved_at_ms=NEW.approved_at_ms)))
BEGIN SELECT RAISE(ABORT,'handoff_transition_denied'); END;
CREATE TRIGGER oauth_handoff_no_delete BEFORE DELETE ON oauth_session_handoffs_v1
BEGIN SELECT RAISE(ABORT,'handoff_delete_denied'); END;
