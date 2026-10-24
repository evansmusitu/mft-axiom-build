-- Add strongly versioned artifacts to the isolated enterprise workspace database.
-- Existing rows receive a transitional token; subsequent writes use random UUID revisions.
-- Apply AFTER 0001 and 0002 on the dedicated, not yet provisioned, D1 instance.
ALTER TABLE tenant_artifacts
  ADD COLUMN revision TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
