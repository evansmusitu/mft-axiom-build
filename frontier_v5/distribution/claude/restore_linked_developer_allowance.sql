-- PROPOSAL ONLY. This file is not deployed or executed by any workflow.
-- Requires explicit authorization to correct shared customer entitlement data.
-- No credentials, tokens, usage consumption, subscription or plan is changed.
WITH linked AS (
    SELECT DISTINCT customer_id
    FROM oauth_access_tokens
    WHERE issuer = :issuer
      AND resource = :resource
      AND created_at >= :since
      AND revoked_at IS NULL
      AND datetime(expires_at) > datetime(:correction_timestamp)
)
UPDATE customers
SET monthly_unit_override = 1000,
    updated_at = :correction_timestamp
WHERE id IN (SELECT customer_id FROM linked)
  AND (SELECT COUNT(*) FROM linked) = 1
  AND plan = 'developer'
  AND status = 'active'
  AND monthly_unit_override IS NULL
  AND created_at = :observed_created_at
  AND updated_at = :observed_updated_at
  AND EXISTS (
      SELECT 1 FROM usage_buckets
      WHERE customer_id = customers.id
        AND month = :month
        AND used_units = 0
        AND unit_limit = 0
  );
