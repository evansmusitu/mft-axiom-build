-- MUSITU Store V2: PRIVATE QUARANTINED CANDIDATE, not production migration.
-- Synthetic evidence ledger for independent Paynow callback + poll observations.
-- It does not validate signatures itself: ONLY the separately reviewed worker can
-- prove both signatures/identities before requesting an INSERT. Data are NOT
-- proof of settlement, entitlement, refund finalization or publisher payout.
-- This is intentionally separate from the shipped D1 Store checkout schema,
-- and must not be applied to Neon, Cloudflare or the live customer database.
CREATE TABLE IF NOT EXISTS store_paynow_status_observations (
  event_id TEXT PRIMARY KEY NOT NULL CHECK(length(event_id) BETWEEN 7 AND 96),
  reference TEXT NOT NULL REFERENCES store_checkout_intents(reference),
  paynow_reference TEXT NOT NULL CHECK(length(paynow_reference) BETWEEN 3 AND 80),
  provider_status TEXT NOT NULL CHECK(provider_status IN
    ('Created','Sent','Cancelled','Disputed','Awaiting Delivery','Delivered')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL CHECK(currency='USD'),
  poll_url TEXT NOT NULL CHECK(length(poll_url) BETWEEN 32 AND 300),
  callback_digest TEXT NOT NULL CHECK(length(callback_digest)=64 AND callback_digest NOT GLOB '*[^a-f0-9]*'),
  poll_digest TEXT NOT NULL CHECK(length(poll_digest)=64 AND poll_digest NOT GLOB '*[^a-f0-9]*'),
  observed_at TEXT NOT NULL CHECK(observed_at GLOB '????-??-??T??:??:??Z' OR observed_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE(reference,callback_digest,poll_digest)
);
CREATE INDEX IF NOT EXISTS idx_store_paynow_observation_ref
  ON store_paynow_status_observations(reference,observed_at);

-- Original Store order identity, amount, currency and poll URL must match.
CREATE TRIGGER IF NOT EXISTS store_paynow_observation_order_identity
BEFORE INSERT ON store_paynow_status_observations
FOR EACH ROW WHEN NOT EXISTS (
 SELECT 1 FROM store_checkout_intents AS intent
 WHERE intent.reference=NEW.reference
   AND intent.amount_cents=NEW.amount_cents
   AND intent.currency=NEW.currency
   AND intent.poll_url=NEW.poll_url
)
BEGIN SELECT RAISE(ABORT,'Store Paynow observation must match existing order identity'); END;

-- A Paynow provider reference belongs to only one Store order, even where a
-- preceding signed paid/refunded review already exists on a different order.
CREATE TRIGGER IF NOT EXISTS store_paynow_observation_no_cross_order_claim
BEFORE INSERT ON store_paynow_status_observations
FOR EACH ROW WHEN EXISTS (
 SELECT 1 FROM store_paynow_status_observations AS previous
 WHERE previous.paynow_reference=NEW.paynow_reference AND previous.reference!=NEW.reference
) OR EXISTS (
 SELECT 1 FROM store_checkout_reviews AS previous
 WHERE previous.paynow_reference=NEW.paynow_reference AND previous.reference!=NEW.reference
)
BEGIN SELECT RAISE(ABORT,'Store Paynow reference already claimed by another order'); END;

-- INSERT OR REPLACE does not fire a regular update trigger. Reject the
-- duplicate before SQLite can perform implicit deletion of prior evidence.
CREATE TRIGGER IF NOT EXISTS store_paynow_observation_no_replace_or_replay
BEFORE INSERT ON store_paynow_status_observations
FOR EACH ROW WHEN EXISTS (
 SELECT 1 FROM store_paynow_status_observations AS previous
 WHERE previous.event_id=NEW.event_id OR
   (previous.reference=NEW.reference AND
    previous.callback_digest=NEW.callback_digest AND
    previous.poll_digest=NEW.poll_digest)
)
BEGIN SELECT RAISE(ABORT,'Store Paynow observation identity/replay is immutable'); END;

CREATE TRIGGER IF NOT EXISTS store_paynow_observation_no_update
BEFORE UPDATE ON store_paynow_status_observations
BEGIN SELECT RAISE(ABORT,'Store Paynow observation cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS store_paynow_observation_no_delete
BEFORE DELETE ON store_paynow_status_observations
BEGIN SELECT RAISE(ABORT,'Store Paynow observation cannot be deleted'); END;

-- The inverse claim must be rejected too. A late Paid/Refunded review cannot
-- appropriate a Paynow reference already observed on a different Store order.
-- This remains necessary even if the existing review table has a UNIQUE index
-- on Paynow reference: it knows nothing about this separate observation table.
CREATE TRIGGER IF NOT EXISTS store_paynow_observation_no_reverse_review_claim
BEFORE INSERT ON store_checkout_reviews
FOR EACH ROW WHEN EXISTS (
 SELECT 1 FROM store_paynow_status_observations AS previous
 WHERE previous.paynow_reference=NEW.paynow_reference
   AND previous.reference!=NEW.reference
)
BEGIN SELECT RAISE(ABORT,'Store Paynow review conflicts with observed order identity'); END;
