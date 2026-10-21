-- No self-service tenant creation. Provision memberships using authorized
-- out-of-band operator workflow after approved Access policy qualification.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspace_tenants (
  tenant_id TEXT PRIMARY KEY NOT NULL CHECK(length(tenant_id) BETWEEN 3 AND 40),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_memberships (
  tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 8 AND 256),
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,subject),
  FOREIGN KEY(tenant_id) REFERENCES workspace_tenants(tenant_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_blobs (
  tenant_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
  encrypted TEXT NOT NULL CHECK(length(encrypted) BETWEEN 100 AND 250000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,slot),
  FOREIGN KEY(tenant_id) REFERENCES workspace_tenants(tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workspace_memberships_subject_idx ON workspace_memberships(subject,tenant_id);
