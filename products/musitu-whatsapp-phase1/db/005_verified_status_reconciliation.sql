-- CANDIDATE ONLY. Requires native PostgreSQL 17, separate migration owner,
-- an authorized outbound sender (not included), and independent review.
-- RLS is inherited from 001 for both existing tables.
-- Legacy outbound attempts without recipient_hash intentionally cannot match
-- authenticated provider statuses: they fail closed until safely reconciled.
BEGIN;
ALTER TABLE musitu.outbound_attempts
 ADD COLUMN recipient_hash text CHECK
 (recipient_hash IS NULL OR recipient_hash ~ '^hmac256:[a-f0-9]{64}$');
ALTER TABLE musitu.message_status_events
 ADD COLUMN payload_fingerprint text CHECK
 (payload_fingerprint IS NULL OR payload_fingerprint ~ '^[a-f0-9]{64}$');
-- The ingress role can reconcile statuses only for preexisting, scoped outbounds.
-- It cannot create an outbound attempt or change its provider ID, recipient,
-- effect key or destination. No payment, membership or booking permissions.
GRANT SELECT ON musitu.outbound_attempts,musitu.message_status_events TO musitu_ingress;
GRANT INSERT ON musitu.message_status_events TO musitu_ingress;
GRANT UPDATE (status) ON musitu.outbound_attempts TO musitu_ingress;
COMMIT;
