-- MUSITU Store V2 private developer journal real PostgreSQL regression.
-- Disposable CI DB only. No real users, APKs, credentials or payout records.
-- All fixture rows are rolled back after enforcement checks.
BEGIN;
INSERT INTO store_publisher_private.submissions
 (submission_id,publisher_id,submitting_subject,idempotency_key,
  request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
  signer_sha256,privacy_policy_url,source_url)
VALUES ('sub-'||repeat('a',32),'fake-test-publisher','developer-actor-1',
 'test-idempotency-0000001',repeat('a',64),'fake-test-app',
 'org.example.testapp',10,repeat('b',64),10000,repeat('c',64),
 'https://example.org/privacy','https://github.com/example/testapp');
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.review_notes
   (submission_id,reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest)
  VALUES ('sub-'||repeat('a',32),'developer-actor-1','review_identity',
   'REQUEST_EVIDENCE',repeat('d',64),repeat('e',64));
 EXCEPTION WHEN raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'developer self-review unexpectedly allowed'; END IF;
END $$;
INSERT INTO store_publisher_private.review_notes
 (submission_id,reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest)
VALUES ('sub-'||repeat('a',32),'independent-identity-reviewer','review_identity',
 'REQUEST_EVIDENCE',repeat('d',64),repeat('e',64));
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.review_notes
   (submission_id,reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest)
  VALUES ('sub-'||repeat('a',32),'independent-identity-reviewer','review_security',
   'NEGATIVE_FINDING',repeat('f',64),repeat('1',64));
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'same human reviewed both roles'; END IF;
END $$;
INSERT INTO store_publisher_private.review_notes
 (submission_id,reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest)
VALUES ('sub-'||repeat('a',32),'independent-security-reviewer','review_security',
 'NEGATIVE_FINDING',repeat('f',64),repeat('1',64));
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  UPDATE store_publisher_private.submissions
   SET version_code=11 WHERE submission_id='sub-'||repeat('a',32);
 EXCEPTION WHEN raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'submitted APK metadata mutated'; END IF;
END $$;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  DELETE FROM store_publisher_private.review_notes WHERE submission_id='sub-'||repeat('a',32);
 EXCEPTION WHEN raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'review evidence deleted'; END IF;
END $$;
DO $$
BEGIN
 IF (SELECT count(*) FROM store_publisher_private.review_notes
     WHERE submission_id='sub-'||repeat('a',32))<>2 THEN
  RAISE EXCEPTION 'exactly two distinct independent reviewer evidence records required';
 END IF;
END $$;
ROLLBACK;
