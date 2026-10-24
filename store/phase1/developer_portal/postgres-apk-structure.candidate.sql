-- PRIVATE/DISPOSABLE PostgreSQL 16 candidate only. Never deploy automatically.
-- Prerequisites in order: review-journal, apk-quarantine, session-status
-- candidate schemas. Records metadata-only structural preflight, NOT scanning,
-- signing, ownership, legal approval, distribution, payments or payouts.
BEGIN;
CREATE TABLE store_publisher_private.apk_structural_checks (
 submission_id TEXT PRIMARY KEY REFERENCES store_publisher_private.apk_quarantine_receipts(submission_id),
 publisher_id TEXT NOT NULL,
 apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[a-f0-9]{64}$'),
 apk_bytes BIGINT NOT NULL CHECK (apk_bytes BETWEEN 22 AND 536870912),
 storage_key TEXT NOT NULL CHECK (length(storage_key) BETWEEN 24 AND 256
   AND storage_key ~ '^private/apk/[a-f0-9]+$'),
 inspector_subject TEXT NOT NULL CHECK (inspector_subject ~ '^[A-Za-z0-9_-]{6,120}$'),
 inspector_token_id TEXT NOT NULL CHECK (inspector_token_id ~ '^[A-Za-z0-9_-]{12,200}$'),
 entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 2 AND 4096),
 expanded_bytes BIGINT NOT NULL CHECK (expanded_bytes BETWEEN 0 AND 2147483648),
 evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
 verdict TEXT NOT NULL DEFAULT 'STRUCTURAL_PREFLIGHT_ONLY'
   CHECK (verdict='STRUCTURAL_PREFLIGHT_ONLY'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(submission_id,publisher_id,apk_sha256,apk_bytes)
   REFERENCES store_publisher_private.apk_quarantine_receipts
   (submission_id,publisher_id,apk_sha256,apk_bytes)
);
CREATE FUNCTION store_publisher_private.require_independent_structural_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM store_publisher_private.apk_quarantine_receipts q
   JOIN store_publisher_private.submissions s
      ON s.submission_id=q.submission_id AND s.publisher_id=q.publisher_id
     AND s.apk_sha256=q.apk_sha256 AND s.apk_bytes=q.apk_bytes
   JOIN store_publisher_private.principal_enrollments reviewer
      ON reviewer.subject_id=NEW.inspector_subject AND reviewer.role='review_security'
   JOIN store_publisher_private.portal_sessions session
      ON session.token_id=NEW.inspector_token_id
     AND session.subject_id=reviewer.subject_id AND session.role='review_security'
     AND session.publisher_id IS NULL
     AND session.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
   WHERE q.submission_id=NEW.submission_id
     AND q.publisher_id=NEW.publisher_id AND q.apk_sha256=NEW.apk_sha256
     AND q.apk_bytes=NEW.apk_bytes AND q.storage_key=NEW.storage_key
     AND q.disposition='QUARANTINED_UNSCANNED'
     AND s.submitting_subject<>NEW.inspector_subject
     AND NOT EXISTS (SELECT 1 FROM store_publisher_private.principal_suspensions x
         WHERE x.subject_id=NEW.inspector_subject)
     AND NOT EXISTS (SELECT 1 FROM store_publisher_private.session_revocations x
         WHERE x.token_id=NEW.inspector_token_id)
 ) THEN
  RAISE EXCEPTION 'unauthorized or unbound structural preflight evidence';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER structural_checks_independent_binding BEFORE INSERT
 ON store_publisher_private.apk_structural_checks
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.require_independent_structural_check();
CREATE TRIGGER structural_checks_no_update_delete BEFORE UPDATE OR DELETE
 ON store_publisher_private.apk_structural_checks
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
REVOKE ALL ON store_publisher_private.apk_structural_checks FROM PUBLIC;
REVOKE ALL ON FUNCTION store_publisher_private.require_independent_structural_check() FROM PUBLIC;
COMMIT;
