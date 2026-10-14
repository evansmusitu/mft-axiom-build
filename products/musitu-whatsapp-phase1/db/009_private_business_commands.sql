-- Additive staging migration. Function owner is a non-login NOBYPASSRLS role.
-- Runtime receives EXECUTE only; no direct UPDATE, membership INSERT or audit mutation.
BEGIN;
CREATE TABLE musitu.action_audit (
 tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
 audit_id uuid NOT NULL DEFAULT gen_random_uuid(), actor_id text NOT NULL,
 action text NOT NULL, reference_id text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,audit_id)
);
ALTER TABLE musitu.action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.action_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.action_audit
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.action_audit FROM PUBLIC;
GRANT SELECT ON musitu.action_audit TO musitu_runtime;
GRANT INSERT ON musitu.action_audit TO musitu_commands;

CREATE FUNCTION musitu.handover(p_actor text,p_conversation uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid; prior text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE'
  AND m.role IN ('OWNER','ADMIN','AGENT') AND t.status='ACTIVE') THEN
  RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT handling_mode INTO prior FROM musitu.conversations
  WHERE tenant_id=scope AND conversation_id=p_conversation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
 IF prior='HUMAN' THEN RETURN false; END IF;
 UPDATE musitu.conversations SET handling_mode='HUMAN' WHERE tenant_id=scope AND conversation_id=p_conversation;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id)
  VALUES(scope,p_actor,'HUMAN_HANDOVER',p_conversation::text);
 RETURN true;
END $$;
CREATE FUNCTION musitu.revoke_member(p_actor text,p_member text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid; member_role text; member_status text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role='OWNER' AND m.status='ACTIVE'
  AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_actor=p_member THEN RAISE EXCEPTION 'OWNER_SELF_REVOCATION_DENIED'; END IF;
 SELECT role,status INTO member_role,member_status FROM musitu.memberships
  WHERE tenant_id=scope AND actor_id=p_member FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
 IF member_role='OWNER' THEN RAISE EXCEPTION 'OWNER_REVOCATION_DENIED'; END IF;
 IF member_status='REVOKED' THEN RETURN false; END IF;
 UPDATE musitu.memberships SET status='REVOKED' WHERE tenant_id=scope AND actor_id=p_member;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id)
  VALUES(scope,p_actor,'MEMBER_REVOKED',p_member);
 RETURN true;
END $$;
-- Temporary CREATE is necessary for ownership transfer, removed below.
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.handover(text,uuid) OWNER TO musitu_commands;
ALTER FUNCTION musitu.revoke_member(text,text) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.handover(text,uuid),musitu.revoke_member(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.handover(text,uuid),musitu.revoke_member(text,text) TO musitu_runtime;
COMMIT;
