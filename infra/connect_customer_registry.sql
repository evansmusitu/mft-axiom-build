-- MUSITU Connect customer runtime draft: research-only, no production migration.
-- SQLite/D1 transactionality: a single admission INSERT and its triggers must
-- atomically record a usage event and increment the tenant's daily counter.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connect_customer_tenants (
  tenant_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','suspended')),
  daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000000)
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
END;

CREATE TRIGGER IF NOT EXISTS connect_customer_after_admission
AFTER INSERT ON connect_customer_usage_events
BEGIN
  INSERT INTO connect_customer_daily_usage (tenant_id, utc_day, used)
  VALUES (NEW.tenant_id, NEW.utc_day, 1)
  ON CONFLICT(tenant_id,utc_day) DO UPDATE SET used = used + 1;
END;
