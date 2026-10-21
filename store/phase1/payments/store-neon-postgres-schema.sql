-- MUSITU Store V2 Neon/PostgreSQL staging schema v1.
-- STANDALONE STORE ONLY. Applies to a fresh, dedicated Neon database.
-- DO NOT run against Axiom, WhatsApp, Mail Fabric, or any existing app DB.
-- No merchants, paid applications, sessions, subscriptions, entitlements,
-- settlements, refunds, payouts or real customer data are seeded.
BEGIN;

CREATE TABLE store_customer_tokens (
 token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 4 AND 128),
 status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active','revoked')),
 expires_at TEXT NOT NULL CHECK (
   expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z
 created_at TEXT NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE store_products (
 sku TEXT PRIMARY KEY CHECK(length(sku) BETWEEN 4 AND 80),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 publisher_type TEXT NOT NULL DEFAULT 'unverified'
   CHECK(publisher_type IN ('unverified','first_party','third_party')),
 status TEXT NOT NULL DEFAULT 'unapproved'
   CHECK(status IN ('unapproved','approved','suspended')),
 created_at TEXT NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE store_checkout_intents (
 reference TEXT PRIMARY KEY CHECK(reference ~ '^STORE-[A-Z0-9]{16,48}$'),
 customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 4 AND 128),
 sku TEXT NOT NULL REFERENCES store_products(sku),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL CHECK(currency='USD'),
 status TEXT NOT NULL CHECK(status IN
    ('initiating','pending','provider_failed','refund_review_required',
     'expired','review_required','cancelled')),
 browser_url TEXT,
 poll_url TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 CONSTRAINT store_pending_needs_provider_urls
  CHECK(status!='pending' OR (browser_url IS NOT NULL AND poll_url IS NOT NULL))
);
CREATE INDEX idx_store_checkout_customer
 ON store_checkout_intents(customer_id,created_at DESC);
CREATE INDEX idx_store_checkout_status
 ON store_checkout_intents(status,expires_at);
-- PG equivalent of D1's unique COLLATE NOCASE index, including terminal rows.
CREATE UNIQUE INDEX idx_store_checkout_provider_poll_once
 ON store_checkout_intents(lower(poll_url)) WHERE poll_url IS NOT NULL;

CREATE TABLE store_checkout_reviews (
 reference TEXT PRIMARY KEY REFERENCES store_checkout_intents(reference),
 paynow_reference TEXT NOT NULL UNIQUE CHECK(length(paynow_reference) BETWEEN 3 AND 80),
 review_status TEXT NOT NULL CHECK(review_status IN
                  ('review_required','refund_review_required')),
 callback_digest TEXT NOT NULL CHECK(callback_digest ~ '^[a-f0-9]{64}$'),
 poll_digest TEXT NOT NULL CHECK(poll_digest ~ '^[a-f0-9]{64}$'),
 reviewed_at TEXT NOT NULL
);

-- Token identity, lifecycle, expiration and tombstone remain immutable.
-- Unlike SQLite, PostgreSQL has no INSERT OR REPLACE bypass.
CREATE FUNCTION store_guard_customer_tokens() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Store customer token records are permanent audit tombstones';
 END IF;
 IF ROW(NEW.token_hash,NEW.customer_id,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.token_hash,OLD.customer_id,OLD.expires_at,OLD.created_at) THEN
  RAISE EXCEPTION 'Store bearer identity and expiry are immutable';
 END IF;
 IF OLD.status='revoked' AND NEW.status <> 'revoked' THEN
  RAISE EXCEPTION 'Revoked Store bearer is terminal';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_customer_tokens
 BEFORE UPDATE OR DELETE ON store_customer_tokens
 FOR EACH ROW EXECUTE FUNCTION store_guard_customer_tokens();

-- A checkout can only be born initiating. Fields and confirmed provider
-- links cannot be rewritten. Reviewed/expired/cancelled rows never reopen.
CREATE FUNCTION store_guard_checkout_intents() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Store checkout references are permanent audit records';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status!='initiating' OR NEW.browser_url IS NOT NULL OR NEW.poll_url IS NOT NULL THEN
   RAISE EXCEPTION 'Store checkout must begin initiating without provider links';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.reference,NEW.customer_id,NEW.sku,NEW.amount_cents,NEW.currency,
        NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
    ROW(OLD.reference,OLD.customer_id,OLD.sku,OLD.amount_cents,OLD.currency,
        OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'Store checkout identity and amount are immutable';
 END IF;
 IF NEW.browser_url IS DISTINCT FROM OLD.browser_url
    OR NEW.poll_url IS DISTINCT FROM OLD.poll_url THEN
  IF NOT (OLD.status='initiating' AND NEW.status='pending') THEN
   RAISE EXCEPTION 'Store provider links require initiating to pending';
  END IF;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status='initiating' AND NEW.status IN
              ('pending','provider_failed','cancelled'))
           OR (OLD.status='pending' AND NEW.status IN
              ('review_required','refund_review_required','cancelled','expired'))) THEN
    RAISE EXCEPTION 'Store checkout state transition forbidden';
  END IF;
 END IF;
 IF NEW.status IN ('review_required','refund_review_required') AND
    NOT EXISTS (SELECT 1 FROM store_checkout_reviews AS evidence
                WHERE evidence.reference=OLD.reference
                  AND evidence.review_status=NEW.status) THEN
   RAISE EXCEPTION 'Store review requires recorded matching signed evidence';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_checkout_intents
 BEFORE INSERT OR UPDATE OR DELETE ON store_checkout_intents
 FOR EACH ROW EXECUTE FUNCTION store_guard_checkout_intents();

-- Signed + independently polled provider evidence stays REVIEW ONLY.
-- Claim must belong to pending order, not a terminal order.
CREATE FUNCTION store_guard_checkout_reviews() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' THEN
  RAISE EXCEPTION 'Signed Store provider review is append-only';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM store_checkout_intents
               WHERE reference=NEW.reference AND status='pending') THEN
  RAISE EXCEPTION 'Provider evidence requires a pending Store checkout';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_checkout_reviews
 BEFORE INSERT OR UPDATE OR DELETE ON store_checkout_reviews
 FOR EACH ROW EXECUTE FUNCTION store_guard_checkout_reviews();

COMMIT;
),
 created_at TEXT NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE store_products (
 sku TEXT PRIMARY KEY CHECK(length(sku) BETWEEN 4 AND 80),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 publisher_type TEXT NOT NULL DEFAULT 'unverified'
   CHECK(publisher_type IN ('unverified','first_party','third_party')),
 status TEXT NOT NULL DEFAULT 'unapproved'
   CHECK(status IN ('unapproved','approved','suspended')),
 created_at TEXT NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE store_checkout_intents (
 reference TEXT PRIMARY KEY CHECK(reference ~ '^STORE-[A-Z0-9]{16,48}$'),
 customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 4 AND 128),
 sku TEXT NOT NULL REFERENCES store_products(sku),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL CHECK(currency='USD'),
 status TEXT NOT NULL CHECK(status IN
    ('initiating','pending','provider_failed','refund_review_required',
     'expired','review_required','cancelled')),
 browser_url TEXT,
 poll_url TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 CONSTRAINT store_pending_needs_provider_urls
  CHECK(status!='pending' OR (browser_url IS NOT NULL AND poll_url IS NOT NULL))
);
CREATE INDEX idx_store_checkout_customer
 ON store_checkout_intents(customer_id,created_at DESC);
CREATE INDEX idx_store_checkout_status
 ON store_checkout_intents(status,expires_at);
-- PG equivalent of D1's unique COLLATE NOCASE index, including terminal rows.
CREATE UNIQUE INDEX idx_store_checkout_provider_poll_once
 ON store_checkout_intents(lower(poll_url)) WHERE poll_url IS NOT NULL;

CREATE TABLE store_checkout_reviews (
 reference TEXT PRIMARY KEY REFERENCES store_checkout_intents(reference),
 paynow_reference TEXT NOT NULL UNIQUE CHECK(length(paynow_reference) BETWEEN 3 AND 80),
 review_status TEXT NOT NULL CHECK(review_status IN
                  ('review_required','refund_review_required')),
 callback_digest TEXT NOT NULL CHECK(callback_digest ~ '^[a-f0-9]{64}$'),
 poll_digest TEXT NOT NULL CHECK(poll_digest ~ '^[a-f0-9]{64}$'),
 reviewed_at TEXT NOT NULL
);

-- Token identity, lifecycle, expiration and tombstone remain immutable.
-- Unlike SQLite, PostgreSQL has no INSERT OR REPLACE bypass.
CREATE FUNCTION store_guard_customer_tokens() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Store customer token records are permanent audit tombstones';
 END IF;
 IF ROW(NEW.token_hash,NEW.customer_id,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.token_hash,OLD.customer_id,OLD.expires_at,OLD.created_at) THEN
  RAISE EXCEPTION 'Store bearer identity and expiry are immutable';
 END IF;
 IF OLD.status='revoked' AND NEW.status <> 'revoked' THEN
  RAISE EXCEPTION 'Revoked Store bearer is terminal';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_customer_tokens
 BEFORE UPDATE OR DELETE ON store_customer_tokens
 FOR EACH ROW EXECUTE FUNCTION store_guard_customer_tokens();

-- A checkout can only be born initiating. Fields and confirmed provider
-- links cannot be rewritten. Reviewed/expired/cancelled rows never reopen.
CREATE FUNCTION store_guard_checkout_intents() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Store checkout references are permanent audit records';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status!='initiating' OR NEW.browser_url IS NOT NULL OR NEW.poll_url IS NOT NULL THEN
   RAISE EXCEPTION 'Store checkout must begin initiating without provider links';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.reference,NEW.customer_id,NEW.sku,NEW.amount_cents,NEW.currency,
        NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
    ROW(OLD.reference,OLD.customer_id,OLD.sku,OLD.amount_cents,OLD.currency,
        OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'Store checkout identity and amount are immutable';
 END IF;
 IF NEW.browser_url IS DISTINCT FROM OLD.browser_url
    OR NEW.poll_url IS DISTINCT FROM OLD.poll_url THEN
  IF NOT (OLD.status='initiating' AND NEW.status='pending') THEN
   RAISE EXCEPTION 'Store provider links require initiating to pending';
  END IF;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status='initiating' AND NEW.status IN
              ('pending','provider_failed','cancelled'))
           OR (OLD.status='pending' AND NEW.status IN
              ('review_required','refund_review_required','cancelled','expired'))) THEN
    RAISE EXCEPTION 'Store checkout state transition forbidden';
  END IF;
 END IF;
 IF NEW.status IN ('review_required','refund_review_required') AND
    NOT EXISTS (SELECT 1 FROM store_checkout_reviews AS evidence
                WHERE evidence.reference=OLD.reference
                  AND evidence.review_status=NEW.status) THEN
   RAISE EXCEPTION 'Store review requires recorded matching signed evidence';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_checkout_intents
 BEFORE INSERT OR UPDATE OR DELETE ON store_checkout_intents
 FOR EACH ROW EXECUTE FUNCTION store_guard_checkout_intents();

-- Signed + independently polled provider evidence stays REVIEW ONLY.
-- Claim must belong to pending order, not a terminal order.
CREATE FUNCTION store_guard_checkout_reviews() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' THEN
  RAISE EXCEPTION 'Signed Store provider review is append-only';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM store_checkout_intents
               WHERE reference=NEW.reference AND status='pending') THEN
  RAISE EXCEPTION 'Provider evidence requires a pending Store checkout';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_store_checkout_reviews
 BEFORE INSERT OR UPDATE OR DELETE ON store_checkout_reviews
 FOR EACH ROW EXECUTE FUNCTION store_guard_checkout_reviews();

COMMIT;
