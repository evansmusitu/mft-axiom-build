-- Adversarial tests on disposable PostgreSQL 16 ONLY. Test identities fake.
-- This transaction is ALWAYS rolled back. No real publisher enrollment.
BEGIN;
INSERT INTO store_publisher_private.submissions
 (submission_id,publisher_id,submitting_subject,idempotency_key,
  request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
  signer_sha256,privacy_policy_url,source_url)
VALUES ('sub-'||repeat('c',32),'test-publisher','developer-human-001',
 'structural-evidence-test-0001',repeat('a',64),'test-application',
 'org.example.app',11,repeat('d',64),10097,repeat('e',64),
 'https://example.org/privacy','https://github.com/example/app');
-- This regression executes after the uploader-session candidate migration.
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
 VALUES ('developer-human-001','developer','test-publisher');
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
 VALUES ('structural-uploader-jti-001','developer-human-001','developer',
 'test-publisher','https://idp.example.org','store-v2-internal',
 EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+3600);
INSERT INTO store_publisher_private.apk_quarantine_receipts
 (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,uploader_subject,uploader_token_id)
VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
 'private/apk/'||repeat('e',48),'developer-human-001','structural-uploader-jti-001');
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
VALUES ('independent-scanner-001','review_security',NULL),
       ('unapproved-app-actor-01','developer','test-publisher');
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
VALUES ('scanner-token-accept-001','independent-scanner-001','review_security',NULL,
 'https://idp.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+3600),
 ('scanner-token-revoked-01','independent-scanner-001','review_security',NULL,
 'https://idp.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+3600);
INSERT INTO store_publisher_private.session_revocations(token_id,reason_digest)
VALUES ('scanner-token-revoked-01',repeat('a',64));
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'unapproved-app-actor-01','scanner-token-accept-001','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),
   5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'unverified security reviewer admitted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('f',48),'independent-scanner-001','scanner-token-accept-001','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),
   5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'wrong private blob accepted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'wrong-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),
   5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception OR foreign_key_violation THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-tenant structural evidence accepted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001',
   'scanner-token-revoked-01','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-revoked-01'),
   5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked reviewer session accepted';END IF;
END $$;
-- These negative cases use an otherwise valid, unrevoked security reviewer.
-- Every unrelated constraint is satisfied; only the signed claim binding varies.
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001',
   'https://attacker.example.org','store-v2-internal',(SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'structural reviewer wrong issuer admitted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001',
   'https://idp.example.org','different-service',(SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'structural reviewer wrong audience admitted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001',
   'https://idp.example.org','store-v2-internal',(SELECT expires_unix+1 FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),5,10437,repeat('f',64));
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'structural reviewer wrong expiration admitted';END IF;
END $$;
INSERT INTO store_publisher_private.apk_structural_checks
 (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
 inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
 'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),
   5,10437,repeat('f',64));
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_publisher_private.apk_structural_checks
   SET verdict='STRUCTURAL_PREFLIGHT_ONLY';
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'structural evidence rewrite allowed';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  DELETE FROM store_publisher_private.apk_structural_checks;
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'structural evidence erasure allowed';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_structural_checks
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
    inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
    inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
  VALUES ('sub-'||repeat('c',32),'test-publisher',repeat('d',64),10097,
   'private/apk/'||repeat('e',48),'independent-scanner-001','scanner-token-accept-001','https://idp.example.org','store-v2-internal',
   (SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id='scanner-token-accept-001'),
   5,10437,repeat('f',64));
 EXCEPTION WHEN unique_violation THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'duplicate structural receipt accepted';END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM store_publisher_private.apk_structural_checks)<>1 THEN
   RAISE EXCEPTION 'expected one immutable structural receipt';
 END IF;
 IF EXISTS (SELECT 1 FROM store_publisher_private.apk_structural_checks
     WHERE verdict<>'STRUCTURAL_PREFLIGHT_ONLY') THEN
   RAISE EXCEPTION 'release authority smuggled into receipt';
 END IF;
END $$;
ROLLBACK;
