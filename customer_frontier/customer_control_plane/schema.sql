-- Candidate migration; do not run on a live database without independent release approval.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','suspended')) DEFAULT 'active');
CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, external_sub TEXT NOT NULL, UNIQUE(issuer,external_sub));
CREATE TABLE IF NOT EXISTS memberships (tenant_id TEXT NOT NULL REFERENCES tenants(id), identity_id TEXT NOT NULL REFERENCES identities(id), role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')), status TEXT NOT NULL CHECK(status IN ('active','revoked')) DEFAULT 'active', PRIMARY KEY(tenant_id,identity_id));
CREATE TABLE IF NOT EXISTS price_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0), grant_units INTEGER NOT NULL CHECK(grant_units>0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)) DEFAULT 0, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), identity_id TEXT NOT NULL REFERENCES identities(id), price_id TEXT NOT NULL REFERENCES price_catalog(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL, grant_units INTEGER NOT NULL CHECK(grant_units>0), state TEXT NOT NULL CHECK(state IN ('pending','settled','void')) DEFAULT 'pending', client_key TEXT NOT NULL, provider_checkout_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,client_key), UNIQUE(provider_checkout_id), FOREIGN KEY(tenant_id,identity_id) REFERENCES memberships(tenant_id,identity_id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_order_tenant ON orders(id,tenant_id);
CREATE TABLE IF NOT EXISTS provider_events (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_transaction_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), kind TEXT NOT NULL CHECK(kind IN ('settlement','refund')), amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider,provider_transaction_id,kind));
CREATE TABLE IF NOT EXISTS credit_ledger (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), delta INTEGER NOT NULL CHECK(delta!=0), source_key TEXT NOT NULL, event_id TEXT REFERENCES provider_events(event_id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,source_key));
CREATE INDEX IF NOT EXISTS ix_ledger_tenant ON credit_ledger(tenant_id);
CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_id TEXT, request_key TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0), state TEXT NOT NULL CHECK(state IN ('open','committed','released')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,request_key), FOREIGN KEY(work_id,tenant_id) REFERENCES work(id,tenant_id));
CREATE INDEX IF NOT EXISTS ix_hold_tenant_state ON holds(tenant_id,state);
CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0), tax_status TEXT NOT NULL DEFAULT 'tax_review_required', issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id,tenant_id) REFERENCES orders(id,tenant_id));
CREATE TABLE IF NOT EXISTS refund_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), order_id TEXT NOT NULL REFERENCES orders(id), identity_id TEXT NOT NULL REFERENCES identities(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0), reason TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('requested','rejected','provider_pending','settled')) DEFAULT 'requested', client_key TEXT NOT NULL, event_id TEXT UNIQUE REFERENCES provider_events(event_id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,client_key), FOREIGN KEY(order_id,tenant_id) REFERENCES orders(id,tenant_id), FOREIGN KEY(tenant_id,identity_id) REFERENCES memberships(tenant_id,identity_id));
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, objective TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES identities(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_project_tenant ON projects(id,tenant_id);
CREATE INDEX IF NOT EXISTS ix_project_tenant ON projects(tenant_id);
CREATE TABLE IF NOT EXISTS work (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, desired_outcome TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('draft','approved','running','verified','blocked')) DEFAULT 'draft', created_by TEXT NOT NULL REFERENCES identities(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_work_tenant ON work(id,tenant_id);
CREATE INDEX IF NOT EXISTS ix_work_project ON work(tenant_id,project_id);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_id TEXT NOT NULL REFERENCES work(id), principal TEXT NOT NULL, scope TEXT NOT NULL, budget_units INTEGER NOT NULL CHECK(budget_units>=0), status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive','active','revoked')), FOREIGN KEY(work_id,tenant_id) REFERENCES work(id,tenant_id));
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_id TEXT NOT NULL REFERENCES work(id), kind TEXT NOT NULL, sha256 TEXT NOT NULL, storage_ref TEXT NOT NULL, evidence_state TEXT NOT NULL DEFAULT 'not_verified' CHECK(evidence_state IN ('not_verified','verified')), FOREIGN KEY(work_id,tenant_id) REFERENCES work(id,tenant_id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_artifact_evidence_scope ON artifacts(id,work_id,tenant_id);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_id TEXT NOT NULL REFERENCES work(id), artifact_id TEXT REFERENCES artifacts(id), claim TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, verifier_subject TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(work_id,tenant_id) REFERENCES work(id,tenant_id), FOREIGN KEY(artifact_id,work_id,tenant_id) REFERENCES artifacts(id,work_id,tenant_id));
CREATE INDEX IF NOT EXISTS ix_evidence_work ON evidence(tenant_id,work_id);
-- The independently authorized ledger is append-only, not editable by tenant actions.
CREATE TRIGGER IF NOT EXISTS axiom_credit_ledger_no_update BEFORE UPDATE ON credit_ledger BEGIN SELECT RAISE(ABORT,'immutable_credit_ledger'); END;
CREATE TRIGGER IF NOT EXISTS axiom_credit_ledger_no_delete BEFORE DELETE ON credit_ledger BEGIN SELECT RAISE(ABORT,'immutable_credit_ledger'); END;
CREATE TRIGGER IF NOT EXISTS axiom_provider_event_no_update BEFORE UPDATE ON provider_events BEGIN SELECT RAISE(ABORT,'immutable_provider_event'); END;
CREATE TRIGGER IF NOT EXISTS axiom_provider_event_no_delete BEFORE DELETE ON provider_events BEGIN SELECT RAISE(ABORT,'immutable_provider_event'); END;
CREATE TRIGGER IF NOT EXISTS axiom_invoice_no_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT,'immutable_invoice'); END;
CREATE TRIGGER IF NOT EXISTS axiom_invoice_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'immutable_invoice'); END;

-- Signed enrollment proof receipts (opaque only, no customer email/key in the evidence record).
CREATE TABLE IF NOT EXISTS enrollment_evidence (
  proof_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  identity_id TEXT NOT NULL REFERENCES identities(id),
  issuer TEXT NOT NULL, external_sub_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL, verifier_identity TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tenant_id,identity_id) REFERENCES memberships(tenant_id,identity_id)
);
CREATE TRIGGER IF NOT EXISTS axiom_enrollment_evidence_no_update BEFORE UPDATE ON enrollment_evidence BEGIN SELECT RAISE(ABORT,'immutable_enrollment_evidence'); END;
CREATE TRIGGER IF NOT EXISTS axiom_enrollment_evidence_no_delete BEFORE DELETE ON enrollment_evidence BEGIN SELECT RAISE(ABORT,'immutable_enrollment_evidence'); END;

-- Independent settlement evidence must preexist the state transition.
CREATE TRIGGER IF NOT EXISTS axiom_order_settlement_requires_event BEFORE UPDATE OF state ON orders
WHEN NEW.state='settled' AND OLD.state!='settled' AND NOT EXISTS (
 SELECT 1 FROM provider_events e WHERE e.order_id=OLD.id AND e.kind='settlement'
 AND e.amount_minor=OLD.amount_minor AND e.currency=OLD.currency
) BEGIN SELECT RAISE(ABORT,'settlement_evidence_required'); END;
CREATE TRIGGER IF NOT EXISTS axiom_refund_settlement_requires_event BEFORE UPDATE OF state ON refund_requests
WHEN NEW.state='settled' AND OLD.state!='settled' AND NOT EXISTS (
 SELECT 1 FROM provider_events e JOIN orders o ON o.id=OLD.order_id
 WHERE e.event_id=NEW.event_id AND e.order_id=OLD.order_id AND e.kind='refund'
 AND e.amount_minor=OLD.amount_minor AND e.currency=o.currency
) BEGIN SELECT RAISE(ABORT,'refund_evidence_required'); END;

-- A provider refund can never cross the original captured amount, even under
-- parallel verification. This check executes at the state transition itself.
CREATE TRIGGER IF NOT EXISTS axiom_refund_cumulative_cap BEFORE UPDATE OF state ON refund_requests
WHEN NEW.state='settled' AND OLD.state!='settled' AND (
 (SELECT COALESCE(SUM(r.amount_minor),0) FROM refund_requests r
  WHERE r.order_id=OLD.order_id AND r.state='settled') + OLD.amount_minor >
 (SELECT o.amount_minor FROM orders o WHERE o.id=OLD.order_id)
) BEGIN SELECT RAISE(ABORT,'refund_exceeds_order_amount'); END;
