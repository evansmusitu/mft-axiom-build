-- Disposable PostgreSQL CI only. Explicitly ROLLBACK all test data.
-- Every negative test MUST see a database error, never manufacture approval.
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM store_v2_developer_submissions)<>0 THEN
  RAISE EXCEPTION 'unexpected populated developer test database';
 END IF;
END $$;
INSERT INTO store_v2_developer_submissions
 (submission_id,publisher_subject,app_id,package_id,version_code,apk_bytes,
  apk_sha256,signing_certificate_sha256,privacy_policy_url)
VALUES ('submission-case01','publisher_001','caseapp','org.example.caseapp',10,5120,
 repeat('a',64),repeat('b',64),'https://example.org/privacy');
INSERT INTO store_v2_developer_review_evidence
 (submission_id,reviewer_role,reviewer_subject,evidence_sha256)
VALUES ('submission-case01','identity','reviewer_001',repeat('c',64));
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_v2_developer_review_evidence(submission_id,reviewer_role,reviewer_subject,evidence_sha256)
   VALUES('submission-case01','security','publisher_001',repeat('d',64));
 EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'self-review succeeded'; END IF;
END $$;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_v2_developer_review_evidence(submission_id,reviewer_role,reviewer_subject,evidence_sha256)
   VALUES('submission-case01','security','reviewer_001',repeat('d',64));
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'same human approved both review roles'; END IF;
END $$;
INSERT INTO store_v2_developer_review_evidence
 (submission_id,reviewer_role,reviewer_subject,evidence_sha256)
VALUES ('submission-case01','security','reviewer_002',repeat('d',64));
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  UPDATE store_v2_developer_submissions SET version_code=999 WHERE submission_id='submission-case01';
 EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'publisher metadata mutation succeeded'; END IF;
END $$;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  DELETE FROM store_v2_developer_review_evidence WHERE submission_id='submission-case01';
 EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'review evidence deletion succeeded'; END IF;
END $$;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO store_v2_developer_review_evidence(submission_id,reviewer_role,reviewer_subject,evidence_sha256)
   VALUES('submission-case01','identity','reviewer_003',repeat('e',64));
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'duplicate reviewer role succeeded'; END IF;
END $$;
DO $$
BEGIN
 IF (SELECT count(*) FROM store_v2_developer_review_evidence WHERE submission_id='submission-case01')<>2 THEN
  RAISE EXCEPTION 'independent reviewers not preserved';
 END IF;
END $$;
ROLLBACK;
