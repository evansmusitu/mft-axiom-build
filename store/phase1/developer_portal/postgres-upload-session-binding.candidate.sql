-- PRIVATE/DISPOSABLE PostgreSQL 16 migration CANDIDATE only. DO NOT apply
-- to production without database custodian review and approved identity.
-- Requires in order: review-journal, apk-quarantine, session-status schemas.
-- Stores no tokens/secret bearer material, only opaque signed JWT jti and
-- enrolled subject binding. No binary publication, payment or entitlement.
BEGIN;
ALTER TABLE store_publisher_private.apk_quarantine_receipts
 ADD COLUMN uploader_subject TEXT NOT NULL
  CHECK (uploader_subject ~ '^[A-Za-z0-9_-]{6,120}$'),
 ADD COLUMN uploader_token_id TEXT NOT NULL
  CHECK (uploader_token_id ~ '^[A-Za-z0-9_-]{12,200}$');
CREATE FUNCTION store_publisher_private.require_current_upload_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1
   FROM store_publisher_private.submissions s
   JOIN store_publisher_private.portal_sessions sess
    ON sess.token_id=NEW.uploader_token_id
    AND sess.subject_id=NEW.uploader_subject
    AND sess.role='developer' AND sess.publisher_id=NEW.publisher_id
    AND sess.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
   JOIN store_publisher_private.principal_enrollments p
    ON p.subject_id=sess.subject_id AND p.role='developer'
      AND p.publisher_id=NEW.publisher_id
   WHERE s.submission_id=NEW.submission_id
     AND s.publisher_id=NEW.publisher_id
     AND s.submitting_subject=NEW.uploader_subject
     AND s.apk_sha256=NEW.apk_sha256 AND s.apk_bytes=NEW.apk_bytes
     AND NOT EXISTS(
      SELECT 1 FROM store_publisher_private.session_revocations rev
      WHERE rev.token_id=NEW.uploader_token_id)
     AND NOT EXISTS(
      SELECT 1 FROM store_publisher_private.principal_suspensions blocked
      WHERE blocked.subject_id=NEW.uploader_subject)
 ) THEN
   RAISE EXCEPTION 'revoked, unbound or expired developer upload session';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_upload_session_at_insert BEFORE INSERT
 ON store_publisher_private.apk_quarantine_receipts
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.require_current_upload_session();
REVOKE ALL ON FUNCTION store_publisher_private.require_current_upload_session() FROM PUBLIC;
COMMIT;
