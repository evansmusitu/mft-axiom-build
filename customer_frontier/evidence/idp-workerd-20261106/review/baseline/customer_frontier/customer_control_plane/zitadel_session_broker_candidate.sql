-- Isolated new staging namespace only. Never apply without backup/schema review.
-- Deliberately no IF NOT EXISTS: collisions or prior bodies require review.
CREATE TABLE customer_idp_flows_v1 (
 state_hash TEXT PRIMARY KEY NOT NULL CHECK(length(state_hash)=64),
 browser_hash TEXT NOT NULL CHECK(length(browser_hash)=64),
 sealed_payload TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
 used_at_ms INTEGER,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','complete','failed')),
 CHECK((status='pending' AND used_at_ms IS NULL) OR (status!='pending' AND used_at_ms IS NOT NULL))
);
CREATE TABLE customer_idp_sessions_v1 (
 session_hash TEXT PRIMARY KEY NOT NULL CHECK(length(session_hash)=64),
 flow_hash TEXT NOT NULL UNIQUE REFERENCES customer_idp_flows_v1(state_hash),
 issuer TEXT NOT NULL,subject TEXT NOT NULL,
 auth_time_ms INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms AND auth_time_ms<=created_at_ms),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version>0)
);
CREATE TRIGGER customer_idp_flow_identity_immutable BEFORE UPDATE OF state_hash,browser_hash,sealed_payload,created_at_ms,expires_at_ms ON customer_idp_flows_v1
BEGIN SELECT RAISE(ABORT,'idp_flow_immutable'); END;
CREATE TRIGGER customer_idp_flow_transition BEFORE UPDATE OF status,used_at_ms ON customer_idp_flows_v1
WHEN NOT ((OLD.status='pending' AND NEW.status='processing' AND OLD.used_at_ms IS NULL AND NEW.used_at_ms IS NOT NULL)
 OR (OLD.status='processing' AND NEW.status IN ('complete','failed') AND NEW.used_at_ms=OLD.used_at_ms))
BEGIN SELECT RAISE(ABORT,'idp_flow_transition_denied'); END;
CREATE TRIGGER customer_idp_flow_replace BEFORE INSERT ON customer_idp_flows_v1
WHEN EXISTS(SELECT 1 FROM customer_idp_flows_v1 WHERE state_hash=NEW.state_hash)
BEGIN SELECT RAISE(ABORT,'idp_flow_replace_denied'); END;
CREATE TRIGGER customer_idp_flow_initial_state BEFORE INSERT ON customer_idp_flows_v1
WHEN NEW.status!='pending' OR NEW.used_at_ms IS NOT NULL
BEGIN SELECT RAISE(ABORT,'idp_flow_initial_state'); END;
CREATE TRIGGER customer_idp_flow_delete BEFORE DELETE ON customer_idp_flows_v1
BEGIN SELECT RAISE(ABORT,'idp_flow_delete_denied'); END;
CREATE TRIGGER customer_idp_session_requires_claim BEFORE INSERT ON customer_idp_sessions_v1
WHEN NOT EXISTS(SELECT 1 FROM customer_idp_flows_v1 WHERE state_hash=NEW.flow_hash AND status='processing' AND expires_at_ms>NEW.created_at_ms)
BEGIN SELECT RAISE(ABORT,'idp_flow_not_claimed'); END;
CREATE TRIGGER customer_idp_session_initial_state BEFORE INSERT ON customer_idp_sessions_v1
WHEN NEW.status!='active' OR NEW.session_version!=1
BEGIN SELECT RAISE(ABORT,'idp_session_initial_state'); END;
CREATE TRIGGER customer_idp_session_identity_immutable BEFORE UPDATE OF session_hash,flow_hash,issuer,subject,auth_time_ms,created_at_ms,expires_at_ms ON customer_idp_sessions_v1
BEGIN SELECT RAISE(ABORT,'idp_session_immutable'); END;
CREATE TRIGGER customer_idp_session_revocation BEFORE UPDATE OF status,session_version ON customer_idp_sessions_v1
WHEN NOT (OLD.status='active' AND NEW.status='revoked' AND NEW.session_version=OLD.session_version+1)
BEGIN SELECT RAISE(ABORT,'idp_session_revocation_terminal'); END;
CREATE TRIGGER customer_idp_session_replace BEFORE INSERT ON customer_idp_sessions_v1
WHEN EXISTS(SELECT 1 FROM customer_idp_sessions_v1 WHERE session_hash=NEW.session_hash OR flow_hash=NEW.flow_hash)
BEGIN SELECT RAISE(ABORT,'idp_session_replace_denied'); END;
CREATE TRIGGER customer_idp_session_delete BEFORE DELETE ON customer_idp_sessions_v1
BEGIN SELECT RAISE(ABORT,'idp_session_delete_denied'); END;
