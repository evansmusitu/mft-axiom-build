-- NEW dedicated LIFELINE Neon project only. Admin/owner MUST differ from runtime role.
BEGIN;
CREATE SCHEMA IF NOT EXISTS lifeline;
CREATE TABLE IF NOT EXISTS lifeline.research_receipts (
  receipt_id uuid PRIMARY KEY,
  tenant_subject text NOT NULL CHECK(length(tenant_subject) BETWEEN 1 AND 200),
  source_sha256 char(64) NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lifeline.research_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeline.research_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifeline_subject_isolation ON lifeline.research_receipts;
CREATE POLICY lifeline_subject_isolation ON lifeline.research_receipts FOR ALL
  USING (tenant_subject=current_setting('lifeline.tenant_subject',true))
  WITH CHECK (tenant_subject=current_setting('lifeline.tenant_subject',true));
COMMIT;
-- Add a distinct NON-OWNER lifeline_runtime role, no BYPASSRLS or INHERIT.
-- GRANT USAGE ON SCHEMA lifeline TO lifeline_runtime;
-- GRANT SELECT, INSERT ON lifeline.research_receipts TO lifeline_runtime;
