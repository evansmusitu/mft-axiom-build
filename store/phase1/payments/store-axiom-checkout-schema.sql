-- MUSITU Store V2: isolated checkout-intent schema derived from Axiom's
-- customer-authenticated, server-priced, provider-backed payment workflow.
-- QUALIFICATION ONLY. DO NOT migrate Axiom's production D1. No seed catalog,
-- customer, secret, release authority, or financial transaction is created.
-- Apply only to a separately created, authorized Store D1 database.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS store_customer_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 4 AND 128),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active','inactive','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_products (
  sku TEXT PRIMARY KEY NOT NULL
    CHECK(length(sku) BETWEEN 4 AND 80),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  publisher_type TEXT NOT NULL DEFAULT 'unverified'
    CHECK(publisher_type IN ('unverified','first_party','third_party')),
  status TEXT NOT NULL DEFAULT 'unapproved'
    CHECK(status IN ('unapproved','approved','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Intentionally NO approved products or keys inserted.

CREATE TABLE IF NOT EXISTS store_checkout_intents (
  reference TEXT PRIMARY KEY NOT NULL
    CHECK(reference LIKE 'STORE-%' AND length(reference) BETWEEN 22 AND 54),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 4 AND 128),
  sku TEXT NOT NULL REFERENCES store_products(sku),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL CHECK(currency='USD'),
  status TEXT NOT NULL CHECK(status IN (
    'initiating','pending','provider_failed','refund_review_required',
    'expired','review_required','cancelled')),
  browser_url TEXT,
  poll_url TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (status!='pending' OR (browser_url IS NOT NULL AND poll_url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_store_checkout_customer
  ON store_checkout_intents(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_checkout_status
  ON store_checkout_intents(status,expires_at);
-- IMPORTANT: No billing_subscriptions, Axiom user quota changes, paid
-- content entitlements or payouts exist in this migration. Store's own
-- settlement and refund tables require separate audited production design.

-- A verified callback plus an independently polled *matching* Paynow
-- transaction creates a REVIEW ONLY. No automatic entitlement, settlement,
-- payout, license or refund is authorized by this table.
CREATE TABLE IF NOT EXISTS store_checkout_reviews (
  reference TEXT PRIMARY KEY NOT NULL
    REFERENCES store_checkout_intents(reference),
  paynow_reference TEXT NOT NULL UNIQUE
    CHECK(length(paynow_reference) BETWEEN 3 AND 80),
  review_status TEXT NOT NULL CHECK(
    review_status IN ('review_required','refund_review_required')),
  callback_digest TEXT NOT NULL CHECK(
    length(callback_digest)=64 AND callback_digest NOT GLOB '*[^a-f0-9]*'),
  poll_digest TEXT NOT NULL CHECK(
    length(poll_digest)=64 AND poll_digest NOT GLOB '*[^a-f0-9]*'),
  reviewed_at TEXT NOT NULL
);
-- Provider reference UNIQUE blocks reuse across different Store order IDs
-- within this Store D1. Axiom billing D1 has a separate schema/binding.
-- A later refund/dispute requires a separately audited review-history design;
-- the existing immutable first review is never silently overwritten here.


-- An administrative SQL update must not manufacture a paid status without
-- the separately signed-callback AND independently polled provider record.
-- This remains review only: NEVER an entitlement, refund or payout.
CREATE TRIGGER IF NOT EXISTS store_review_requires_signed_evidence
BEFORE UPDATE OF status ON store_checkout_intents
FOR EACH ROW
WHEN NEW.status IN ('review_required','refund_review_required')
 AND (OLD.status != 'pending' OR NOT EXISTS (
   SELECT 1 FROM store_checkout_reviews AS proof
   WHERE proof.reference=OLD.reference AND proof.review_status=NEW.status
 ))
BEGIN
 SELECT RAISE(ABORT,'store review status requires matching provider evidence');
END;


-- Store-only immutable state machine. No Axiom subscription, quota or
-- entitlement changes. A later refund requires a separate auditable event
-- model; previously reviewed orders cannot be reopened for payment.
CREATE TRIGGER IF NOT EXISTS store_checkout_no_reopen
BEFORE UPDATE OF status ON store_checkout_intents
FOR EACH ROW WHEN NEW.status != OLD.status AND NOT (
 (OLD.status='initiating' AND NEW.status IN ('pending','provider_failed','cancelled'))
 OR (OLD.status='pending' AND NEW.status IN
       ('review_required','refund_review_required','cancelled','expired'))
)
BEGIN
 SELECT RAISE(ABORT,'store checkout terminal status cannot be reopened');
END;

-- An individually signed provider claim must belong to a currently pending
-- Store order, including for direct D1 writes outside the Worker path.
CREATE TRIGGER IF NOT EXISTS store_provider_claim_pending_only
BEFORE INSERT ON store_checkout_reviews
FOR EACH ROW WHEN NOT EXISTS (
 SELECT 1 FROM store_checkout_intents AS intent
 WHERE intent.reference=NEW.reference AND intent.status='pending'
)
BEGIN
 SELECT RAISE(ABORT,'store payment claim requires pending order');
END;

-- Signed provider evidence is a historical review record, not a mutable
-- eligibility flag or an entitlement. Reconciliation requires append-only
-- financial events in a later separately audited design.
CREATE TRIGGER IF NOT EXISTS store_review_immutable_update
BEFORE UPDATE ON store_checkout_reviews
BEGIN
 SELECT RAISE(ABORT,'store payment review evidence is immutable');
END;
CREATE TRIGGER IF NOT EXISTS store_review_immutable_delete
BEFORE DELETE ON store_checkout_reviews
BEGIN
 SELECT RAISE(ABORT,'store payment review evidence cannot be deleted');
END;

-- The original browser/Poll URL, SKU and charged amount form the immutable
-- identity of a pending payment. The one legitimate initiating->pending
-- update fills the two URLs before checkout is returned to the customer.
CREATE TRIGGER IF NOT EXISTS store_pending_order_identity_immutable
BEFORE UPDATE OF reference,customer_id,sku,amount_cents,currency,
                 browser_url,poll_url ON store_checkout_intents
FOR EACH ROW WHEN OLD.status != 'initiating'
BEGIN
 SELECT RAISE(ABORT,'store pending payment identity is immutable');
END;
