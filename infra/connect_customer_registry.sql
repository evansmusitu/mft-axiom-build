-- MUSITU Connect customer runtime draft: research-only, no production migration.
-- SQLite/D1 transactionality: a single admission INSERT and its triggers must
-- atomically record a usage event and increment daily and minute counters.
-- D1 enforces foreign-key constraints by default. The Node SQLite test
-- fixture enables PRAGMA foreign_keys separately; do not embed a runtime
-- transaction-scoped PRAGMA in the shared D1 migration.

CREATE TABLE IF NOT EXISTS connect_customer_tenants (
  tenant_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','suspended')),
  daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000000),
  minute_limit INTEGER NOT NULL CHECK(minute_limit BETWEEN 1 AND 1000000)
);

CREATE TABLE IF NOT EXISTS connect_customer_credentials (
  credential_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES connect_customer_tenants(tenant_id),
  token_sha256 TEXT UNIQUE NOT NULL CHECK(length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
  expires_at TEXT NOT NULL,
  can_plan INTEGER NOT NULL CHECK(can_plan IN (0,1)),
  can_risk INTEGER NOT NULL CHECK(can_risk IN (0,1)),
  CHECK(can_plan=1 OR can_risk=1)
);

CREATE TABLE IF NOT EXISTS connect_customer_daily_usage (
  tenant_id TEXT NOT NULL REFERENCES connect_customer_tenants(tenant_id),
  utc_day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  PRIMARY KEY (tenant_id, utc_day)
);

CREATE TABLE IF NOT EXISTS connect_customer_minute_usage (
  tenant_id TEXT NOT NULL REFERENCES connect_customer_tenants(tenant_id),
  utc_minute TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  PRIMARY KEY (tenant_id, utc_minute)
);

CREATE TABLE IF NOT EXISTS connect_customer_usage_events (
  tenant_id TEXT NOT NULL REFERENCES connect_customer_tenants(tenant_id),
  credential_id TEXT NOT NULL REFERENCES connect_customer_credentials(credential_id),
  request_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('mining.plan','mining.risk')),
  utc_day TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, request_id)
);

CREATE TRIGGER IF NOT EXISTS connect_customer_before_admission
BEFORE INSERT ON connect_customer_usage_events
BEGIN
  -- Mirror crypto.randomUUID field positions, variant and lowercase hex.
  -- Small GLOB avoids workerd SQLite's "pattern too complex" limit.
  -- A direct D1/SQLite insert cannot bypass UUID validation
  -- and allocate a quota unit under an ambiguous request identifier.
  SELECT RAISE(ABORT, 'CUSTOMER_EVENT_REQUEST_ID_INVALID') WHERE
    length(NEW.request_id) != 36
    OR substr(NEW.request_id, 9, 1) != '-'
    OR substr(NEW.request_id, 14, 1) != '-'
    OR substr(NEW.request_id, 19, 1) != '-'
    OR substr(NEW.request_id, 24, 1) != '-'
    OR substr(NEW.request_id, 15, 1) != '4'
    OR substr(NEW.request_id, 20, 1) NOT IN ('8','9','a','b')
    OR length(replace(NEW.request_id, '-', '')) != 32
    OR replace(NEW.request_id, '-', '') GLOB '*[^0-9a-f]*';
  -- A REPLACE conflict can delete a prior row without firing DELETE triggers
  -- when SQLite recursive_triggers is off, while charging its counters twice.
  -- Explicitly reject duplicate tenant/request keys *before* conflict handling.
  SELECT RAISE(ABORT, 'CUSTOMER_EVENT_DUPLICATE_REQUEST_ID') WHERE EXISTS (
    SELECT 1 FROM connect_customer_usage_events e
    WHERE e.tenant_id=NEW.tenant_id AND e.request_id=NEW.request_id
  );
  -- A mislabeled day must never evade the per-day or per-minute counters.
  -- JS Date.toISOString() emits exactly three fractional-second digits.
  SELECT RAISE(ABORT, 'CUSTOMER_EVENT_TIME_INVALID') WHERE
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.observed_at) IS NULL
    OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.observed_at) != NEW.observed_at
    OR substr(NEW.observed_at,1,10) != NEW.utc_day
    -- SQLite may allow the 24:00 alias of next-day midnight while retaining
    -- the preceding UTC day text, mischarging its day/minute quota.
    OR substr(NEW.observed_at,12,2) = '24';
  SELECT RAISE(ABORT, 'CUSTOMER_AUTH_REVOKED') WHERE NOT EXISTS (
    SELECT 1 FROM connect_customer_credentials c
    JOIN connect_customer_tenants t ON t.tenant_id = c.tenant_id
    WHERE c.credential_id = NEW.credential_id
      AND c.tenant_id = NEW.tenant_id
      AND c.status = 'active' AND t.status = 'active'
      AND (CASE NEW.scope WHEN 'mining.plan' THEN c.can_plan ELSE c.can_risk END) = 1
      AND unixepoch(c.expires_at) > unixepoch(NEW.observed_at)
  );
  SELECT RAISE(ABORT, 'CUSTOMER_QUOTA_EXCEEDED') WHERE
    COALESCE((SELECT used FROM connect_customer_daily_usage
       WHERE tenant_id = NEW.tenant_id AND utc_day = NEW.utc_day), 0)
    >= (SELECT daily_limit FROM connect_customer_tenants WHERE tenant_id = NEW.tenant_id);
  SELECT RAISE(ABORT, 'CUSTOMER_MINUTE_QUOTA_EXCEEDED') WHERE
    COALESCE((SELECT used FROM connect_customer_minute_usage
       WHERE tenant_id = NEW.tenant_id AND utc_minute = substr(NEW.observed_at,1,16)), 0)
    >= (SELECT minute_limit FROM connect_customer_tenants WHERE tenant_id = NEW.tenant_id);
END;

CREATE TRIGGER IF NOT EXISTS connect_customer_after_admission
AFTER INSERT ON connect_customer_usage_events
BEGIN
  INSERT INTO connect_customer_daily_usage (tenant_id, utc_day, used)
  VALUES (NEW.tenant_id, NEW.utc_day, 1)
  ON CONFLICT(tenant_id,utc_day) DO UPDATE SET used = used + 1;
  INSERT INTO connect_customer_minute_usage (tenant_id, utc_minute, used)
  VALUES (NEW.tenant_id, substr(NEW.observed_at,1,16), 1)
  ON CONFLICT(tenant_id,utc_minute) DO UPDATE SET used = used + 1;
END;

-- Usage events are append-only within the ordinary customer DB access path.
-- An UPDATE or DELETE can sever the signed-in tenant/request attribution from
-- already-charged daily and minute counters without reversing those counters.
-- No retention/erasure policy or privileged reconciliation operation is
-- authorized by this research-only draft; a future reviewed migration must
-- implement those separately instead of silently erasing usage evidence.
CREATE TRIGGER IF NOT EXISTS connect_customer_event_no_update
BEFORE UPDATE ON connect_customer_usage_events
BEGIN
  SELECT RAISE(ABORT, 'CUSTOMER_USAGE_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS connect_customer_event_no_delete
BEFORE DELETE ON connect_customer_usage_events
BEGIN
  SELECT RAISE(ABORT, 'CUSTOMER_USAGE_EVENT_IMMUTABLE');
END;
