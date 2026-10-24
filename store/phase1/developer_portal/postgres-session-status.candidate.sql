-- PRIVATE DISPOSABLE DATABASE REVIEW CANDIDATE ONLY.
-- After postgres-review-journal.candidate.sql, in explicitly isolated DB.
-- Empty by design: no fake or automatic real IdP enrollment, role grants,
-- production credentials, token issuance, payments, or Store publication.
BEGIN;
CREATE TABLE store_publisher_private.principal_enrollments (
 subject_id TEXT PRIMARY KEY CHECK (subject_id ~ '^[A-Za-z0-9_-]{6,120}$'),
 role TEXT NOT NULL CHECK (role IN ('developer','review_identity','review_security')),
 publisher_id TEXT CHECK (publisher_id ~ '^[a-z][a-z0-9-]{2,63}$'),
 enrolled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK ((role='developer' AND publisher_id IS NOT NULL) OR
        (role IN ('review_identity','review_security') AND publisher_id IS NULL))
);
CREATE TABLE store_publisher_private.portal_sessions (
 token_id TEXT PRIMARY KEY CHECK (token_id ~ '^[A-Za-z0-9_-]{12,200}$'),
 subject_id TEXT NOT NULL REFERENCES store_publisher_private.principal_enrollments(subject_id),
 role TEXT NOT NULL CHECK (role IN ('developer','review_identity','review_security')),
 publisher_id TEXT CHECK (publisher_id ~ '^[a-z][a-z0-9-]{2,63}$'),
 issuer_uri TEXT NOT NULL CHECK (issuer_uri ~ '^https://[^[:space:]]+$' AND length(issuer_uri)<=256),
 audience TEXT NOT NULL CHECK (length(audience) BETWEEN 5 AND 120),
 expires_unix BIGINT NOT NULL CHECK (expires_unix>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION store_publisher_private.require_session_principal_binding()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM store_publisher_private.principal_enrollments p
    WHERE p.subject_id=NEW.subject_id AND p.role=NEW.role
      AND p.publisher_id IS NOT DISTINCT FROM NEW.publisher_id) THEN
    RAISE EXCEPTION 'unverified principal/role/publisher identity';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_session_principal_binding BEFORE INSERT
 ON store_publisher_private.portal_sessions
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.require_session_principal_binding();
CREATE TABLE store_publisher_private.session_revocations (
 token_id TEXT PRIMARY KEY REFERENCES store_publisher_private.portal_sessions(token_id),
 reason_digest TEXT NOT NULL CHECK (reason_digest ~ '^[a-f0-9]{64}$'),
 revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE store_publisher_private.principal_suspensions (
 subject_id TEXT PRIMARY KEY REFERENCES store_publisher_private.principal_enrollments(subject_id),
 reason_digest TEXT NOT NULL CHECK (reason_digest ~ '^[a-f0-9]{64}$'),
 suspended_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Immutable enrollments, token bindings and revocations.
CREATE TRIGGER enrolled_principals_immutable BEFORE UPDATE OR DELETE
 ON store_publisher_private.principal_enrollments
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
CREATE TRIGGER portal_sessions_immutable BEFORE UPDATE OR DELETE
 ON store_publisher_private.portal_sessions
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
CREATE TRIGGER session_revocations_immutable BEFORE UPDATE OR DELETE
 ON store_publisher_private.session_revocations
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
CREATE TRIGGER principal_suspensions_immutable BEFORE UPDATE OR DELETE
 ON store_publisher_private.principal_suspensions
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
REVOKE ALL ON store_publisher_private.principal_enrollments,
 store_publisher_private.portal_sessions, store_publisher_private.session_revocations,
 store_publisher_private.principal_suspensions FROM PUBLIC;
REVOKE ALL ON FUNCTION store_publisher_private.require_session_principal_binding() FROM PUBLIC;
COMMIT;
