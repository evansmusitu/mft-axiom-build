-- MUSITU Connect Neon synthetic-only qualification schema.
-- Reproduces the independently hosted PostgreSQL-17 qualification exercise.
-- NEVER apply to a production database or existing customer schema.
-- No runtime grants: separate security-reviewed application role required.
BEGIN;
CREATE SCHEMA connect_qualification;

CREATE TABLE connect_qualification.tenants (
 tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
 status text NOT NULL CHECK (status IN ('active','suspended')),
 daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 1000000),
 minute_limit integer NOT NULL CHECK (minute_limit BETWEEN 1 AND 1000000)
);
CREATE TABLE connect_qualification.credentials (
 credential_id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES connect_qualification.tenants(tenant_id),
 token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
 expires_at timestamptz NOT NULL,
 can_plan boolean NOT NULL,
 can_risk boolean NOT NULL,
 CHECK (can_plan OR can_risk)
);
CREATE TABLE connect_qualification.daily_usage (
 tenant_id text NOT NULL REFERENCES connect_qualification.tenants(tenant_id),
 utc_day date NOT NULL,
 used bigint NOT NULL CHECK(used>=0),
 PRIMARY KEY(tenant_id,utc_day)
);
CREATE TABLE connect_qualification.minute_usage (
 tenant_id text NOT NULL REFERENCES connect_qualification.tenants(tenant_id),
 utc_minute timestamp NOT NULL,
 used bigint NOT NULL CHECK(used>=0),
 PRIMARY KEY(tenant_id,utc_minute)
);
CREATE TABLE connect_qualification.events (
 tenant_id text NOT NULL REFERENCES connect_qualification.tenants(tenant_id),
 credential_id text NOT NULL REFERENCES connect_qualification.credentials(credential_id),
 request_id uuid NOT NULL,
 scope text NOT NULL CHECK(scope IN ('mining.plan','mining.risk')),
 utc_day date NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(tenant_id,request_id)
);
CREATE FUNCTION connect_qualification.admit(p_digest text,p_scope text,p_request_id uuid)
RETURNS TABLE (accepted boolean,code text,authorized_tenant text,daily_used bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,connect_qualification
AS $$
DECLARE
 v_tenant text;v_credential text;v_day date;v_min timestamp;v_time timestamptz;
 v_limit integer;v_min_limit integer;v_daily bigint;v_min_used bigint;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_scope IS NULL
 OR p_scope NOT IN('mining.plan','mining.risk') OR p_request_id IS NULL THEN
  RETURN QUERY SELECT false,'UNAUTHORIZED'::text,NULL::text,NULL::bigint;RETURN;
 END IF;
 v_time:=transaction_timestamp();
 v_day:=(v_time AT TIME ZONE 'UTC')::date;
 v_min:=date_trunc('minute',v_time AT TIME ZONE 'UTC');
 SELECT t.tenant_id,c.credential_id,t.daily_limit,t.minute_limit
 INTO v_tenant,v_credential,v_limit,v_min_limit
 FROM connect_qualification.tenants t
 INNER JOIN connect_qualification.credentials c ON c.tenant_id=t.tenant_id
 WHERE c.token_sha256=p_digest AND c.status='active' AND t.status='active'
 AND c.expires_at>v_time
 AND (CASE p_scope WHEN 'mining.plan' THEN c.can_plan ELSE c.can_risk END)
 FOR UPDATE OF t,c;
 IF v_tenant IS NULL THEN
  RETURN QUERY SELECT false,'UNAUTHORIZED'::text,NULL::text,NULL::bigint;RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM connect_qualification.events e
     WHERE e.tenant_id=v_tenant AND e.request_id=p_request_id) THEN
  RETURN QUERY SELECT false,'REQUEST_ID_CONFLICT'::text,v_tenant,NULL::bigint;RETURN;
 END IF;
 SELECT COALESCE((SELECT d.used FROM connect_qualification.daily_usage d
    WHERE d.tenant_id=v_tenant AND d.utc_day=v_day),0) INTO v_daily;
 SELECT COALESCE((SELECT m.used FROM connect_qualification.minute_usage m
    WHERE m.tenant_id=v_tenant AND m.utc_minute=v_min),0) INTO v_min_used;
 IF v_daily>=v_limit THEN
  RETURN QUERY SELECT false,'CUSTOMER_QUOTA_EXCEEDED'::text,v_tenant,v_daily;RETURN;
 END IF;
 IF v_min_used>=v_min_limit THEN
  RETURN QUERY SELECT false,'CUSTOMER_MINUTE_QUOTA_EXCEEDED'::text,v_tenant,v_daily;RETURN;
 END IF;
 INSERT INTO connect_qualification.events(tenant_id,credential_id,request_id,scope,utc_day,observed_at)
 VALUES(v_tenant,v_credential,p_request_id,p_scope,v_day,v_time);
 INSERT INTO connect_qualification.daily_usage(tenant_id,utc_day,used)
 VALUES(v_tenant,v_day,1)
 ON CONFLICT(tenant_id,utc_day) DO UPDATE
 SET used=connect_qualification.daily_usage.used+1;
 INSERT INTO connect_qualification.minute_usage(tenant_id,utc_minute,used)
 VALUES(v_tenant,v_min,1)
 ON CONFLICT(tenant_id,utc_minute) DO UPDATE
 SET used=connect_qualification.minute_usage.used+1;
 RETURN QUERY SELECT true,'ADMITTED'::text,v_tenant,v_daily+1;
END $$;
CREATE FUNCTION connect_qualification.protect_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 BEGIN RAISE EXCEPTION 'CUSTOMER_USAGE_EVENT_IMMUTABLE'
 USING ERRCODE='23514'; END $$;
CREATE TRIGGER events_append_only
 BEFORE UPDATE OR DELETE ON connect_qualification.events
 FOR EACH ROW EXECUTE FUNCTION connect_qualification.protect_events();
REVOKE ALL ON SCHEMA connect_qualification FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA connect_qualification FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA connect_qualification FROM PUBLIC;
COMMIT;
