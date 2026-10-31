-- Disposable PostgreSQL 16 adversarial tests; *all records roll back*.
BEGIN;
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
 VALUES ('binding-developer-001','developer','test-publisher');
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
 VALUES ('binding-session-jti-00001','binding-developer-001','developer',
 'test-publisher','https://idp.example.org','store-v2-internal',
 EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
INSERT INTO store_publisher_private.submissions
 (submission_id,publisher_id,submitting_subject,idempotency_key,
 request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
 signer_sha256,privacy_policy_url,source_url)
VALUES ('sub-'||repeat('e',32),'test-publisher','binding-developer-001',
 'binding-test-idempotency-0001',repeat('a',64),'binding-test-app',
 'org.example.bindingtest',10,repeat('b',64),128,repeat('c',64),
 'https://example.org/privacy','https://github.com/example/bindingtest');
INSERT INTO store_publisher_private.apk_quarantine_receipts
 (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,uploader_subject,uploader_token_id)
 VALUES ('sub-'||repeat('e',32),'test-publisher',repeat('b',64),128,
 'private/apk/'||repeat('1',48),'binding-developer-001','binding-session-jti-00001');
DO $$ BEGIN
 IF (SELECT count(*) FROM store_publisher_private.apk_quarantine_receipts)<>1 THEN
  RAISE EXCEPTION 'authorized private session failed to create one receipt';END IF;
END $$;
INSERT INTO store_publisher_private.submissions
 (submission_id,publisher_id,submitting_subject,idempotency_key,
 request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
 signer_sha256,privacy_policy_url,source_url)
 VALUES ('sub-'||repeat('f',32),'test-publisher','binding-developer-001',
 'binding-test-idempotency-0002',repeat('a',64),'binding-test-app',
 'org.example.bindingtest',11,repeat('b',64),128,repeat('c',64),
 'https://example.org/privacy','https://github.com/example/bindingtest');
-- A valid token for the correct owner is REVOKED before INSERT.
INSERT INTO store_publisher_private.session_revocations(token_id,reason_digest)
 VALUES ('binding-session-jti-00001',repeat('d',64));
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_quarantine_receipts
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,uploader_subject,uploader_token_id)
  VALUES ('sub-'||repeat('f',32),'test-publisher',repeat('b',64),128,
   'private/apk/'||repeat('2',48),'binding-developer-001','binding-session-jti-00001');
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked uploader recorded forbidden receipt';END IF;
END $$;
-- New active session cannot impersonate someone else's uploader principal.
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
 VALUES ('wrong-developer-002','developer','test-publisher');
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
 VALUES ('wrong-binding-jti-00002','wrong-developer-002','developer',
 'test-publisher','https://idp.example.org','store-v2-internal',
 EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_quarantine_receipts
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,uploader_subject,uploader_token_id)
  VALUES ('sub-'||repeat('f',32),'test-publisher',repeat('b',64),128,
   'private/apk/'||repeat('3',48),'wrong-developer-002','wrong-binding-jti-00002');
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-subject upload receipt accepted';END IF;
END $$;
INSERT INTO store_publisher_private.session_revocations(token_id,reason_digest)
 VALUES ('wrong-binding-jti-00002',repeat('e',64));
DO $$ BEGIN
 IF (SELECT count(*) FROM store_publisher_private.apk_quarantine_receipts)<>1 THEN
  RAISE EXCEPTION 'mutated private quarantine receipt count';END IF;
END $$;
ROLLBACK;
