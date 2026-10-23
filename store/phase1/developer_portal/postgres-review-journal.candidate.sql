-- MUSITU Store V2: DDL-only private developer portal journal candidate.
-- Not executed on production OR existing Store staging. Never auto-publish.
-- Apply only to an independently approved and backed-up isolated database.
-- No actual publisher, reviewer, customer or APK bytes are seeded.
BEGIN;

CREATE SCHEMA store_publisher_private;
REVOKE ALL ON SCHEMA store_publisher_private FROM PUBLIC;

CREATE TABLE store_publisher_private.submissions (
  submission_id TEXT PRIMARY KEY
    CHECK (submission_id ~ '^sub-[a-f0-9]{32}$'),
  publisher_id TEXT NOT NULL
    CHECK (publisher_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  submitting_subject TEXT NOT NULL
    CHECK (length(submitting_subject) BETWEEN 6 AND 120),
  idempotency_key TEXT NOT NULL
    CHECK (idempotency_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
  request_digest TEXT NOT NULL
    CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  app_id TEXT NOT NULL CHECK (app_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  package_id TEXT NOT NULL CHECK (length(package_id) BETWEEN 3 AND 255),
  version_code BIGINT NOT NULL
    CHECK (version_code BETWEEN 1 AND 9007199254740991),
  apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[a-f0-9]{64}$'),
  apk_bytes BIGINT NOT NULL CHECK (apk_bytes BETWEEN 1 AND 536870912),
  signer_sha256 TEXT NOT NULL CHECK (signer_sha256 ~ '^[a-f0-9]{64}$'),
  privacy_policy_url TEXT NOT NULL CHECK (length(privacy_policy_url) BETWEEN 9 AND 2000),
  source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 9 AND 2000),
  status TEXT NOT NULL DEFAULT 'review_required'
    CHECK (status='review_required'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (publisher_id,idempotency_key),
  UNIQUE (publisher_id,package_id,version_code)
);

CREATE TABLE store_publisher_private.review_notes (
  submission_id TEXT NOT NULL
    REFERENCES store_publisher_private.submissions(submission_id),
  reviewer_subject TEXT NOT NULL
    CHECK (length(reviewer_subject) BETWEEN 6 AND 120),
  reviewer_role TEXT NOT NULL
    CHECK (reviewer_role IN ('review_identity','review_security')),
  decision TEXT NOT NULL
    CHECK (decision IN ('REQUEST_EVIDENCE','NEGATIVE_FINDING',
                        'EVIDENCE_CAPTURED_FOR_INDEPENDENT_REVIEW')),
  evidence_sha256 TEXT NOT NULL
    CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  review_digest TEXT NOT NULL
    CHECK (review_digest ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (submission_id,reviewer_role),
  UNIQUE (submission_id,reviewer_subject)
);

-- Even an authenticated second-role reviewer cannot attest their own app.
-- Enforce on real database writes, not only the JWT API controller.
CREATE FUNCTION store_publisher_private.reject_self_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
 IF EXISTS (SELECT 1 FROM store_publisher_private.submissions s
            WHERE s.submission_id=NEW.submission_id
              AND s.submitting_subject=NEW.reviewer_subject) THEN
  RAISE EXCEPTION 'developer self-review denied';
 END IF;
 RETURN NEW;
END $;
CREATE TRIGGER private_reviews_no_self_attestation
 BEFORE INSERT ON store_publisher_private.review_notes
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_self_review();

-- Deny mutations to submitted material and reviewer evidence.
CREATE FUNCTION store_publisher_private.reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Store V2 private publisher evidence is append-only';
END $$;
CREATE TRIGGER private_submissions_no_change
  BEFORE UPDATE OR DELETE ON store_publisher_private.submissions
  FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
CREATE TRIGGER private_reviews_no_change
  BEFORE UPDATE OR DELETE ON store_publisher_private.review_notes
  FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();

-- Important: no CREATE LOGIN, GRANT, open public policies, or production
-- credentials. Apply least-privilege grants to a dedicated service role
-- only AFTER real OIDC issuer, MFA, owner approval and audit integration.
REVOKE ALL ON ALL TABLES IN SCHEMA store_publisher_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA store_publisher_private FROM PUBLIC;

COMMIT;
