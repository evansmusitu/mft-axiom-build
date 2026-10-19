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
