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
