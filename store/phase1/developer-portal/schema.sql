-- New isolated private developer pre-admission schema; NOT applied to Neon.
-- Operator-only separate least-privilege role. No checkout, refunds or release.
-- Never create production publishers or transfer commercial credentials.
BEGIN;
CREATE TABLE store_v2_developer_submissions (
 submission_id TEXT PRIMARY KEY CHECK(submission_id ~ '^submission-[A-Za-z0-9_-]{3,60}$'),
 publisher_subject TEXT NOT NULL CHECK(publisher_subject ~ '^[A-Za-z0-9_-]{8,90}$'),
 app_id TEXT NOT NULL CHECK(app_id ~ '^[a-z][a-z0-9-]{2,63}$'),
 package_id TEXT NOT NULL CHECK(length(package_id) BETWEEN 3 AND 255),
 version_code BIGINT NOT NULL CHECK(version_code BETWEEN 1 AND 2100000000),
 apk_bytes BIGINT NOT NULL CHECK(apk_bytes BETWEEN 512 AND 536870912),
 apk_sha256 TEXT NOT NULL CHECK(apk_sha256 ~ '^[a-f0-9]{64}$'),
 signing_certificate_sha256 TEXT NOT NULL CHECK(signing_certificate_sha256 ~ '^[a-f0-9]{64}$'),
 privacy_policy_url TEXT NOT NULL CHECK(length(privacy_policy_url) BETWEEN 9 AND 1800),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_store_v2_developer_private_publisher
 ON store_v2_developer_submissions(publisher_subject,submitted_at DESC);
CREATE TABLE store_v2_developer_review_evidence (
 submission_id TEXT NOT NULL REFERENCES store_v2_developer_submissions(submission_id),
 reviewer_role TEXT NOT NULL CHECK(reviewer_role IN ('identity','security')),
 reviewer_subject TEXT NOT NULL CHECK(reviewer_subject ~ '^[A-Za-z0-9_-]{8,90}$'),
 evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(submission_id,reviewer_role),
 UNIQUE(submission_id,reviewer_subject)
);
-- Prevent a privileged SQL writer from self-attesting as publisher and reviewer.
CREATE FUNCTION store_v2_guard_review_self_attestation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM store_v2_developer_submissions s
           WHERE s.submission_id=NEW.submission_id
             AND s.publisher_subject=NEW.reviewer_subject) THEN
  RAISE EXCEPTION 'publisher cannot self-review';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_v2_review_separation_of_duties
 BEFORE INSERT ON store_v2_developer_review_evidence FOR EACH ROW
 EXECUTE FUNCTION store_v2_guard_review_self_attestation();
-- Immutable applicant metadata and append-only reviewer evidence.
CREATE FUNCTION store_v2_reject_evidence_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'MUSITU Store private developer evidence is append-only';
END $$;
CREATE TRIGGER store_v2_developer_submission_immutable
 BEFORE UPDATE OR DELETE ON store_v2_developer_submissions FOR EACH ROW
 EXECUTE FUNCTION store_v2_reject_evidence_mutation();
CREATE TRIGGER store_v2_developer_review_immutable
 BEFORE UPDATE OR DELETE ON store_v2_developer_review_evidence FOR EACH ROW
 EXECUTE FUNCTION store_v2_reject_evidence_mutation();
-- No public role grants, automatic publisher approvals, paid entitlements or payouts.
COMMIT;
