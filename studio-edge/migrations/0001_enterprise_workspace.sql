-- New, separately provisioned D1 database only. Never apply to an existing project.
PRAGMA foreign_keys = ON;
CREATE TABLE tenants (tenant_id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  subject TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  PRIMARY KEY (tenant_id,subject)
);
CREATE TABLE tenant_artifacts (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL, iv TEXT NOT NULL, ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version=1), updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,artifact_id)
);
CREATE TABLE tenant_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL, artifact_id TEXT NOT NULL, subject TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('put','delete')), at INTEGER NOT NULL
);
CREATE INDEX tenant_audit_scope ON tenant_audit(tenant_id,at);
