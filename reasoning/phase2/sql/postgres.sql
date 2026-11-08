CREATE TABLE IF NOT EXISTS axiom_temporal_facts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value_json JSONB NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  supersedes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acquisition_json JSONB,
  authentication_json JSONB,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE axiom_temporal_facts
  ADD COLUMN IF NOT EXISTS acquisition_json JSONB;

ALTER TABLE axiom_temporal_facts
  ADD COLUMN IF NOT EXISTS authentication_json JSONB;

CREATE INDEX IF NOT EXISTS axiom_temporal_lookup
  ON axiom_temporal_facts(tenant_id, entity, attribute, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS axiom_world_snapshots (
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS axiom_platform_executions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS axiom_execution_intents (
  tenant_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, intent_id)
);

CREATE TABLE IF NOT EXISTS axiom_evidence_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  artifact_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS axiom_evidence_acquisitions (
  tenant_id TEXT NOT NULL,
  acquisition_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, acquisition_id)
);

CREATE TABLE IF NOT EXISTS axiom_ingestion_nonces (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key_id, nonce)
);

CREATE TABLE IF NOT EXISTS axiom_authorization_grants (
  principal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  PRIMARY KEY (principal_id, tenant_id, action, grant_id)
);

CREATE TABLE IF NOT EXISTS axiom_idempotency_records (
  principal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETE')),
  status_code INTEGER,
  body_json TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (principal_id, tenant_id, action, idempotency_key_hash)
);

CREATE TABLE IF NOT EXISTS axiom_audit_heads (
  tenant_id TEXT PRIMARY KEY,
  record_count BIGINT NOT NULL,
  head_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS axiom_audit_records (
  tenant_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  request_id TEXT NOT NULL,
  principal_id TEXT,
  action TEXT NOT NULL,
  resource_json JSONB NOT NULL,
  credential_token_hash TEXT,
  authorization_decision_hash TEXT,
  request_hash TEXT NOT NULL,
  idempotency_key_hash TEXT,
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sequence)
);


CREATE TABLE IF NOT EXISTS axiom_model_exchange_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  request_body_hash TEXT NOT NULL,
  response_body_hash TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_body TEXT NOT NULL,
  artifact_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS axiom_model_compilations (
  tenant_id TEXT NOT NULL,
  compilation_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  compiled_program_hash TEXT,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, compilation_id)
);


CREATE TABLE IF NOT EXISTS axiom_model_explanations (
  tenant_id TEXT NOT NULL,
  explanation_id TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  request_body_hash TEXT NOT NULL,
  response_body_hash TEXT NOT NULL,
  normalized_response_body_hash TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_body TEXT NOT NULL,
  normalized_response_body TEXT NOT NULL,
  record_json JSONB NOT NULL,
  PRIMARY KEY (tenant_id, explanation_id)
);


CREATE TABLE IF NOT EXISTS axiom_distributed_execution_jobs (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  intent_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','LEASED','SUCCEEDED','DENIED','STALE','FAILED_INTEGRITY')),
  lease_epoch BIGINT NOT NULL,
  attempt_count BIGINT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  terminal_at TEXT,
  result_json JSONB,
  result_hash TEXT,
  failure_code TEXT,
  state_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS axiom_distributed_execution_claim
  ON axiom_distributed_execution_jobs(status, lease_expires_at, created_at, job_id);

-- Phase 2.5C additive authenticated-worker migrations.
ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_worker_key_id TEXT;
ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_pool_id TEXT;
ALTER TABLE axiom_distributed_execution_jobs ADD COLUMN IF NOT EXISTS lease_capability_hash TEXT;
CREATE TABLE IF NOT EXISTS axiom_worker_operation_receipts(
 worker_id TEXT NOT NULL,worker_key_id TEXT NOT NULL,request_id TEXT NOT NULL,
 action TEXT NOT NULL,request_hash TEXT NOT NULL,outcome_json JSONB NOT NULL,
 outcome_hash TEXT NOT NULL,created_at TEXT NOT NULL,receipt_hash TEXT NOT NULL,
 receipt_signer_key_id TEXT NOT NULL,receipt_signature_base64 TEXT NOT NULL,
 PRIMARY KEY(worker_id,request_id));
CREATE TABLE IF NOT EXISTS axiom_worker_security_mode(
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton=TRUE),
 enabled BOOLEAN NOT NULL CHECK(enabled=TRUE));

ALTER TABLE axiom_worker_operation_receipts ADD COLUMN IF NOT EXISTS receipt_signer_key_id TEXT;
ALTER TABLE axiom_worker_operation_receipts ADD COLUMN IF NOT EXISTS receipt_signature_base64 TEXT;

-- Phase 2.7A: operator-owned tenant admission quota registry.
CREATE TABLE IF NOT EXISTS axiom_tenant_admission_quota_mode(
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton=TRUE)
);
CREATE TABLE IF NOT EXISTS axiom_tenant_admission_quotas(
 tenant_id TEXT PRIMARY KEY,
 max_outstanding_jobs BIGINT NOT NULL CHECK(max_outstanding_jobs BETWEEN 1 AND 1000000),
 policy_hash TEXT NOT NULL
);

-- Phase 2.7B opt-in durable tenant service rotation.
CREATE TABLE IF NOT EXISTS axiom_tenant_fair_mode(
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton=TRUE)
);
CREATE TABLE IF NOT EXISTS axiom_tenant_fair_cursor(
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton=TRUE),
 ordinal BIGINT NOT NULL CHECK(ordinal>=0)
);
CREATE TABLE IF NOT EXISTS axiom_tenant_fair_served(
 tenant_id TEXT PRIMARY KEY,
 last_ordinal BIGINT NOT NULL CHECK(last_ordinal>0)
);


-- Phase 2.10A central provider-cost reserve/settle accounting.
-- Operator access to budget provisioning must be restricted by DB grants/IAM.
CREATE TABLE IF NOT EXISTS axiom_provider_spend_budgets(
 tenant_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 limit_micro_usd BIGINT NOT NULL CHECK(limit_micro_usd>=0),
 charged_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK(charged_micro_usd>=0),
 reserved_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
 suspended BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(tenant_id,provider,model_id)
);
CREATE TABLE IF NOT EXISTS axiom_provider_spend_requests(
 tenant_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 reserve_micro_usd BIGINT NOT NULL CHECK(reserve_micro_usd>0),
 status TEXT NOT NULL CHECK(status IN ('RESERVED','SETTLED','OVERAGE')),
 charge_micro_usd BIGINT CHECK(charge_micro_usd>=0),
 response_hash TEXT,
 PRIMARY KEY(tenant_id,provider,model_id,request_id),
 FOREIGN KEY(tenant_id,provider,model_id)
   REFERENCES axiom_provider_spend_budgets(tenant_id,provider,model_id)
);

-- Phase 2.10B: vendor organization cap across tenants, adapters and models.
-- Existing budgets receive NULL vendor and fail closed until audited backfill.
ALTER TABLE axiom_provider_spend_budgets
  ADD COLUMN IF NOT EXISTS billing_provider TEXT
  CHECK (billing_provider IN ('openai','anthropic'));
CREATE TABLE IF NOT EXISTS axiom_provider_spend_organizations(
 billing_provider TEXT PRIMARY KEY CHECK(billing_provider IN ('openai','anthropic')),
 limit_micro_usd BIGINT NOT NULL CHECK(limit_micro_usd>=0),
 charged_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK(charged_micro_usd>=0),
 reserved_micro_usd BIGINT NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
 suspended BOOLEAN NOT NULL DEFAULT FALSE
);


-- Phase 2.10C: DRAFT, operator-reviewed, protected provider spend RPC boundary.
-- This migration does NOT create or grant a production runtime role. An
-- operator must separately grant USAGE+EXECUTE to a restricted non-owner role.
-- Direct billing-table DML must NEVER be granted to that role. No Worker wiring.
-- PostgreSQL 17 defaults require function creation and PUBLIC revocation atomically.
BEGIN;
CREATE SCHEMA IF NOT EXISTS axiom_spend;
REVOKE ALL ON SCHEMA axiom_spend FROM PUBLIC;

CREATE OR REPLACE FUNCTION axiom_spend.reserve(
 p_tenant text,p_provider text,p_model text,p_request text,p_hash text,p_amount bigint,p_vendor text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $axiom_reserve$
DECLARE
 bound_vendor text;
 org_limit numeric;org_charged numeric;org_held numeric;org_suspended boolean;
 tenant_limit numeric;tenant_charged numeric;tenant_held numeric;tenant_suspended boolean;
 locked_vendor text;prior_hash text;prior_status text;
BEGIN
 IF p_tenant IS NULL OR length(btrim(p_tenant))=0 OR length(p_tenant)>256 OR
    p_provider IS NULL OR length(btrim(p_provider))=0 OR length(p_provider)>256 OR
    p_model IS NULL OR length(btrim(p_model))=0 OR length(p_model)>256 OR
    p_request IS NULL OR length(btrim(p_request))=0 OR length(p_request)>256 OR
    p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR
    p_amount IS NULL OR p_amount<1 OR p_amount>9007199254740991 OR
    p_vendor IS NULL OR p_vendor NOT IN ('openai','anthropic') THEN
   RETURN 'BUDGET_INVALID_REQUEST';
 END IF;
 SELECT b.billing_provider INTO bound_vendor
   FROM public.axiom_provider_spend_budgets AS b
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model;
 IF NOT FOUND THEN RETURN 'BUDGET_NOT_PROVISIONED'; END IF;
 IF bound_vendor IS DISTINCT FROM p_vendor THEN RETURN 'BUDGET_ORGANIZATION_MISMATCH'; END IF;
 -- Always lock the shared vendor row before the tenant row.
 SELECT o.limit_micro_usd,o.charged_micro_usd,o.reserved_micro_usd,o.suspended
   INTO org_limit,org_charged,org_held,org_suspended
   FROM public.axiom_provider_spend_organizations AS o
  WHERE o.billing_provider=p_vendor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'BUDGET_ORGANIZATION_NOT_PROVISIONED'; END IF;
 SELECT b.limit_micro_usd,b.charged_micro_usd,b.reserved_micro_usd,b.suspended,b.billing_provider
   INTO tenant_limit,tenant_charged,tenant_held,tenant_suspended,locked_vendor
   FROM public.axiom_provider_spend_budgets AS b
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model FOR UPDATE;
 IF NOT FOUND THEN RETURN 'BUDGET_NOT_PROVISIONED'; END IF;
 IF locked_vendor IS DISTINCT FROM p_vendor THEN RETURN 'BUDGET_ORGANIZATION_MISMATCH'; END IF;
 IF org_suspended IS DISTINCT FROM FALSE THEN RETURN 'BUDGET_ORGANIZATION_SUSPENDED'; END IF;
 IF tenant_suspended IS DISTINCT FROM FALSE THEN RETURN 'BUDGET_SUSPENDED'; END IF;
 IF org_limit>9007199254740991 OR org_charged>9007199254740991 OR org_held>9007199254740991 OR
    tenant_limit>9007199254740991 OR tenant_charged>9007199254740991 OR tenant_held>9007199254740991 OR
    org_charged+org_held>9007199254740991 OR tenant_charged+tenant_held>9007199254740991 THEN
   RETURN 'BUDGET_CORRUPT';
 END IF;
 SELECT r.request_hash,r.status INTO prior_hash,prior_status
   FROM public.axiom_provider_spend_requests AS r
  WHERE r.tenant_id=p_tenant AND r.provider=p_provider AND r.model_id=p_model AND r.request_id=p_request;
 IF FOUND THEN
   IF prior_hash IS DISTINCT FROM p_hash THEN RETURN 'BUDGET_IDENTITY_COLLISION'; END IF;
   IF prior_status='RESERVED' THEN RETURN 'BUDGET_PENDING_RECONCILIATION'; END IF;
   RETURN 'BUDGET_ALREADY_SETTLED';
 END IF;
 IF p_amount>org_limit-org_charged-org_held THEN RETURN 'BUDGET_ORGANIZATION_EXCEEDED'; END IF;
 IF p_amount>tenant_limit-tenant_charged-tenant_held THEN RETURN 'BUDGET_EXCEEDED'; END IF;
 IF org_held+p_amount>9007199254740991 OR tenant_held+p_amount>9007199254740991 THEN
   RETURN 'BUDGET_CORRUPT';
 END IF;
 INSERT INTO public.axiom_provider_spend_requests
   (tenant_id,provider,model_id,request_id,request_hash,reserve_micro_usd,status)
   VALUES(p_tenant,p_provider,p_model,p_request,p_hash,p_amount,'RESERVED');
 UPDATE public.axiom_provider_spend_budgets AS b
    SET reserved_micro_usd=b.reserved_micro_usd+p_amount
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model;
 UPDATE public.axiom_provider_spend_organizations AS o
    SET reserved_micro_usd=o.reserved_micro_usd+p_amount
  WHERE o.billing_provider=p_vendor;
 RETURN 'OK';
END;
$axiom_reserve$;
REVOKE ALL ON FUNCTION axiom_spend.reserve(text,text,text,text,text,bigint,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION axiom_spend.settle(
 p_tenant text,p_provider text,p_model text,p_request text,p_hash text,p_charge bigint,p_response text,p_vendor text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $axiom_settle$
DECLARE
 bound_vendor text;locked_vendor text;
 org_limit numeric;org_charged numeric;org_held numeric;
 tenant_limit numeric;tenant_charged numeric;tenant_held numeric;
 prior_hash text;prior_status text;prior_reserve numeric;
 excessive boolean;org_overage boolean;
BEGIN
 IF p_tenant IS NULL OR length(btrim(p_tenant))=0 OR length(p_tenant)>256 OR
    p_provider IS NULL OR length(btrim(p_provider))=0 OR length(p_provider)>256 OR
    p_model IS NULL OR length(btrim(p_model))=0 OR length(p_model)>256 OR
    p_request IS NULL OR length(btrim(p_request))=0 OR length(p_request)>256 OR
    p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR
    p_response IS NULL OR p_response !~ '^[0-9a-f]{64}$' OR
    p_charge IS NULL OR p_charge<0 OR p_charge>9007199254740991 OR
    p_vendor IS NULL OR p_vendor NOT IN ('openai','anthropic') THEN
   RETURN 'BUDGET_INVALID_REQUEST';
 END IF;
 SELECT b.billing_provider INTO bound_vendor
   FROM public.axiom_provider_spend_budgets AS b
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model;
 IF NOT FOUND THEN RETURN 'BUDGET_NOT_PROVISIONED'; END IF;
 IF bound_vendor IS DISTINCT FROM p_vendor THEN RETURN 'BUDGET_ORGANIZATION_MISMATCH'; END IF;
 SELECT o.limit_micro_usd,o.charged_micro_usd,o.reserved_micro_usd
   INTO org_limit,org_charged,org_held
   FROM public.axiom_provider_spend_organizations AS o
  WHERE o.billing_provider=p_vendor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'BUDGET_ORGANIZATION_NOT_PROVISIONED'; END IF;
 SELECT b.limit_micro_usd,b.charged_micro_usd,b.reserved_micro_usd,b.billing_provider
   INTO tenant_limit,tenant_charged,tenant_held,locked_vendor
   FROM public.axiom_provider_spend_budgets AS b
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model FOR UPDATE;
 IF NOT FOUND THEN RETURN 'BUDGET_NOT_PROVISIONED'; END IF;
 IF locked_vendor IS DISTINCT FROM p_vendor THEN RETURN 'BUDGET_ORGANIZATION_MISMATCH'; END IF;
 SELECT r.request_hash,r.status,r.reserve_micro_usd
   INTO prior_hash,prior_status,prior_reserve
   FROM public.axiom_provider_spend_requests AS r
  WHERE r.tenant_id=p_tenant AND r.provider=p_provider AND r.model_id=p_model AND r.request_id=p_request
  FOR UPDATE;
 IF NOT FOUND OR prior_hash IS DISTINCT FROM p_hash OR prior_status IS DISTINCT FROM 'RESERVED' THEN
   RETURN 'BUDGET_SETTLEMENT_FORBIDDEN';
 END IF;
 IF org_limit>9007199254740991 OR org_charged>9007199254740991 OR org_held>9007199254740991 OR
    tenant_limit>9007199254740991 OR tenant_charged>9007199254740991 OR tenant_held>9007199254740991 OR
    prior_reserve>9007199254740991 OR prior_reserve>org_held OR prior_reserve>tenant_held OR
    org_charged+p_charge>9007199254740991 OR tenant_charged+p_charge>9007199254740991 THEN
   RETURN 'BUDGET_CORRUPT';
 END IF;
 excessive := p_charge>prior_reserve;
 org_overage := excessive OR org_charged+p_charge>org_limit;
 UPDATE public.axiom_provider_spend_requests AS r
    SET status=CASE WHEN org_overage THEN 'OVERAGE' ELSE 'SETTLED' END,
        charge_micro_usd=p_charge,response_hash=p_response
  WHERE r.tenant_id=p_tenant AND r.provider=p_provider AND r.model_id=p_model AND r.request_id=p_request;
 UPDATE public.axiom_provider_spend_budgets AS b
    SET charged_micro_usd=b.charged_micro_usd+p_charge,
        reserved_micro_usd=b.reserved_micro_usd-prior_reserve,
        suspended=CASE WHEN excessive THEN TRUE ELSE b.suspended END
  WHERE b.tenant_id=p_tenant AND b.provider=p_provider AND b.model_id=p_model;
 UPDATE public.axiom_provider_spend_organizations AS o
    SET charged_micro_usd=o.charged_micro_usd+p_charge,
        reserved_micro_usd=o.reserved_micro_usd-prior_reserve,
        suspended=CASE WHEN org_overage THEN TRUE ELSE o.suspended END
  WHERE o.billing_provider=p_vendor;
 -- The overage must be recorded before the caller surfaces an error.
 IF org_overage THEN RETURN 'BUDGET_PROVIDER_OVERAGE'; END IF;
 RETURN 'OK';
END;
$axiom_settle$;
REVOKE ALL ON FUNCTION axiom_spend.settle(text,text,text,text,text,bigint,text,text) FROM PUBLIC;
COMMIT;
