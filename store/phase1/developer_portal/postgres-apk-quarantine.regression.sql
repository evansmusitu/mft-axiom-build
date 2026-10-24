-- Disposable PostgreSQL adversarial regression, rollback guaranteed.
BEGIN;
INSERT INTO store_publisher_private.submissions
 (submission_id,publisher_id,submitting_subject,idempotency_key,
  request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
  signer_sha256,privacy_policy_url,source_url)
VALUES ('sub-'||repeat('b',32),'fake-test-publisher','developer-actor-1',
 'quarantine-test-idempotency-0001',repeat('a',64),'fake-test-app',
 'org.example.testapp',10,repeat('b',64),128,repeat('c',64),
 'https://example.org/privacy','https://github.com/example/testapp');
INSERT INTO store_publisher_private.apk_quarantine_receipts
 (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key)
VALUES ('sub-'||repeat('b',32),'fake-test-publisher',repeat('b',64),128,
 'private/apk/'||repeat('1',32));
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_publisher_private.apk_quarantine_receipts
   (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key)
  VALUES ('sub-'||repeat('b',32),'wrong-tenant',repeat('b',64),128,
   'private/apk/'||repeat('2',32));
 EXCEPTION WHEN unique_violation OR raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'tenant mismatch accepted'; END IF;
END $$;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  UPDATE store_publisher_private.apk_quarantine_receipts
  SET disposition='QUARANTINED_UNSCANNED'
  WHERE submission_id='sub-'||repeat('b',32);
 EXCEPTION WHEN raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'quarantine journal mutation accepted'; END IF;
END $$;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  DELETE FROM store_publisher_private.apk_quarantine_receipts
  WHERE submission_id='sub-'||repeat('b',32);
 EXCEPTION WHEN raise_exception THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'quarantine journal deletion accepted'; END IF;
END $$;
DO $$
BEGIN
 IF (SELECT count(*) FROM store_publisher_private.apk_quarantine_receipts)<>1 THEN
  RAISE EXCEPTION 'expected one quarantined, unscanned receipt';
 END IF;
END $$;
ROLLBACK;
