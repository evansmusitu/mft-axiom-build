-- Run on DISPOSABLE PG 16 only after both candidate schema files; always ROLLBACK.
BEGIN;
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
 VALUES ('test-developer-001','developer','test-publisher'),
 ('identity-reviewer-001','review_identity',NULL),
 ('security-reviewer-001','review_security',NULL);
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
 VALUES ('signed-test-jti-00001','test-developer-001','developer','test-publisher',
 'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
DO $$ BEGIN
 IF (SELECT count(*) FROM store_publisher_private.portal_sessions s
    JOIN store_publisher_private.principal_enrollments p ON p.subject_id=s.subject_id
    WHERE s.token_id='signed-test-jti-00001' AND s.publisher_id='test-publisher'
      AND s.role='developer' AND s.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM store_publisher_private.session_revocations r WHERE r.token_id=s.token_id)
      AND NOT EXISTS(SELECT 1 FROM store_publisher_private.principal_suspensions d WHERE d.subject_id=s.subject_id))<>1 THEN
  RAISE EXCEPTION 'positive private session binding absent'; END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.portal_sessions
   (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
  VALUES ('cross-publisher-jti01','test-developer-001','developer','attacker-publisher',
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-publisher session admitted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.portal_sessions
   (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
  VALUES ('reviewer-role-switch01','test-developer-001','review_security',NULL,
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'same human role switch admitted';END IF;
END $$;
INSERT INTO store_publisher_private.session_revocations(token_id,reason_digest)
 VALUES ('signed-test-jti-00001',repeat('a',64));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM store_publisher_private.portal_sessions s
    WHERE s.token_id='signed-test-jti-00001'
      AND NOT EXISTS(SELECT 1 FROM store_publisher_private.session_revocations r WHERE r.token_id=s.token_id)) THEN
 RAISE EXCEPTION 'revoked token remains active';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  DELETE FROM store_publisher_private.session_revocations WHERE token_id='signed-test-jti-00001';
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revocation deletion accepted';END IF;
END $$;
INSERT INTO store_publisher_private.principal_suspensions(subject_id,reason_digest)
 VALUES ('test-developer-001',repeat('b',64));
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_publisher_private.principal_enrollments
   SET publisher_id='attacker-publisher' WHERE subject_id='test-developer-001';
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'identity reassignment accepted';END IF;
END $$;
DO $$ DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_publisher_private.portal_sessions
   SET expires_unix=expires_unix+3600 WHERE token_id='signed-test-jti-00001';
 EXCEPTION WHEN raise_exception THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'session expiry extension accepted';END IF;
END $$;
ROLLBACK;
