BEGIN;
CREATE TABLE musitu.business_configuration(
 tenant_id uuid PRIMARY KEY REFERENCES musitu.tenants(id),
 timezone text NOT NULL DEFAULT 'Africa/Harare',
 business_description text NOT NULL DEFAULT '' CHECK(length(business_description)<=2000),
 workflow jsonb NOT NULL DEFAULT '{"unknownQuestion":"HANDOVER","responseApproval":"REQUIRED"}',
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE musitu.business_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.business_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.business_configuration
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.business_configuration FROM PUBLIC;
GRANT SELECT ON musitu.business_configuration TO musitu_runtime;
GRANT SELECT,INSERT,UPDATE ON musitu.business_configuration TO musitu_commands;
GRANT INSERT ON musitu.tenants,musitu.memberships,musitu.resources,musitu.faqs TO musitu_commands;
GRANT UPDATE(legal_name) ON musitu.tenants TO musitu_commands;
CREATE FUNCTION musitu.configure_business(p_actor text,p_timezone text,p_description text) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid; v integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) OR p_description IS NULL OR length(p_description)>2000 THEN RAISE EXCEPTION 'INVALID_CONFIGURATION'; END IF;
 INSERT INTO musitu.business_configuration(tenant_id,timezone,business_description) VALUES(scope,p_timezone,p_description)
 ON CONFLICT(tenant_id) DO UPDATE SET timezone=excluded.timezone,business_description=excluded.business_description,revision=musitu.business_configuration.revision+1,updated_at=now() RETURNING revision INTO v;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'BUSINESS_CONFIGURED',v::text);
 RETURN v;
END $$;
CREATE FUNCTION musitu.approve_knowledge(p_actor text,p_id uuid,p_question text,p_answer text,p_approved boolean) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_approved IS DISTINCT FROM true OR p_id IS NULL OR length(trim(p_question)) NOT BETWEEN 1 AND 1000 OR length(trim(p_answer)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'KNOWLEDGE_APPROVAL_REQUIRED'; END IF;
 -- Immutable source IDs: edits create a new source, retaining approval history.
 INSERT INTO musitu.faqs(tenant_id,faq_id,normalized_question,answer) VALUES(scope,p_id,lower(regexp_replace(trim(p_question),'\s+',' ','g')),p_answer);
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'KNOWLEDGE_APPROVED',p_id::text);
 RETURN p_id;
END $$;
CREATE FUNCTION musitu.onboard_business(p_actor text,p_name text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := gen_random_uuid();
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$' OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_ONBOARDING'; END IF;
 PERFORM set_config('app.tenant_id',scope::text,true);
 INSERT INTO musitu.tenants(id,legal_name,status) VALUES(scope,p_name,'ACTIVE');
 INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES(scope,p_actor,'OWNER','ACTIVE');
 INSERT INTO musitu.business_configuration(tenant_id) VALUES(scope);
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'BUSINESS_ONBOARDED',scope::text);
 RETURN scope;
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.configure_business(text,text,text) OWNER TO musitu_commands;
ALTER FUNCTION musitu.approve_knowledge(text,uuid,text,text,boolean) OWNER TO musitu_commands;
ALTER FUNCTION musitu.onboard_business(text,text) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.configure_business(text,text,text),musitu.approve_knowledge(text,uuid,text,text,boolean),musitu.onboard_business(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.configure_business(text,text,text),musitu.approve_knowledge(text,uuid,text,text,boolean),musitu.onboard_business(text,text) TO musitu_runtime;
COMMIT;
