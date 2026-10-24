-- Separate, never automatically applied, private-only candidate extension.
-- Requires postgres-review-journal.candidate.sql, approved DB custodian and
-- dedicated write role. No public object URL, approval, distribution, payment.
BEGIN;
CREATE TABLE store_publisher_private.apk_quarantine_receipts (
 submission_id TEXT PRIMARY KEY REFERENCES store_publisher_private.submissions(submission_id),
 publisher_id TEXT NOT NULL,
 apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[a-f0-9]{64}$'),
 apk_bytes BIGINT NOT NULL CHECK (apk_bytes BETWEEN 4 AND 536870912),
 storage_key TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 24 AND 256 AND storage_key ~ '^[a-zA-Z0-9/_-]+$'),
 disposition TEXT NOT NULL DEFAULT 'QUARANTINED_UNSCANNED'
  CHECK (disposition='QUARANTINED_UNSCANNED'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(submission_id,publisher_id,apk_sha256,apk_bytes)
);
-- Foreign-key alone cannot enforce tenant/hash identity; require exact
-- immutable manifest binding even if a caller bypasses Node.
CREATE FUNCTION store_publisher_private.validate_quarantine_receipt()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM store_publisher_private.submissions s
    WHERE s.submission_id=NEW.submission_id AND s.publisher_id=NEW.publisher_id
      AND s.apk_sha256=NEW.apk_sha256 AND s.apk_bytes=NEW.apk_bytes) THEN
  RAISE EXCEPTION 'quarantine receipt mismatches immutable submission';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_receipt_binding BEFORE INSERT
 ON store_publisher_private.apk_quarantine_receipts
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.validate_quarantine_receipt();
CREATE TRIGGER private_receipts_no_change BEFORE UPDATE OR DELETE
 ON store_publisher_private.apk_quarantine_receipts
 FOR EACH ROW EXECUTE FUNCTION store_publisher_private.reject_mutation();
REVOKE ALL ON store_publisher_private.apk_quarantine_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION store_publisher_private.validate_quarantine_receipt() FROM PUBLIC;
COMMIT;
