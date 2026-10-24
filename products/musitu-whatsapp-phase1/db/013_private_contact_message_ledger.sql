BEGIN;
CREATE TABLE musitu.contacts(
 tenant_id uuid NOT NULL,phone_number_id text NOT NULL,
 remote_hash text NOT NULL CHECK(remote_hash ~ '^hmac256:[a-f0-9]{64}$'),
 encrypted_recipient text NOT NULL CHECK(length(encrypted_recipient)<=500),
 PRIMARY KEY(tenant_id,phone_number_id,remote_hash),
 FOREIGN KEY(tenant_id,phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);
CREATE TABLE musitu.messages(
 tenant_id uuid NOT NULL,phone_number_id text NOT NULL,provider_message_id text NOT NULL,
 conversation_id uuid NOT NULL,encrypted_body text NOT NULL CHECK(length(encrypted_body)<=10000),
 retained_until timestamptz NOT NULL DEFAULT now()+interval '30 days',
 PRIMARY KEY(tenant_id,phone_number_id,provider_message_id),
 FOREIGN KEY(tenant_id,phone_number_id,provider_message_id) REFERENCES musitu.inbound_events(tenant_id,phone_number_id,provider_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES musitu.conversations(tenant_id,conversation_id)
);
ALTER TABLE musitu.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE musitu.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.contacts
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_boundary ON musitu.messages
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.contacts,musitu.messages FROM PUBLIC;
GRANT SELECT ON musitu.contacts,musitu.messages TO musitu_runtime;
GRANT SELECT,INSERT ON musitu.contacts,musitu.messages TO musitu_ingress;
CREATE FUNCTION musitu.add_staff(p_actor text,p_member text,p_role text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role='OWNER' AND m.status='ACTIVE' AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_member IS NULL OR p_member !~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$' OR p_role NOT IN ('ADMIN','AGENT','VIEWER') OR p_role IS NULL THEN RAISE EXCEPTION 'INVALID_MEMBERSHIP'; END IF;
 INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES(scope,p_member,p_role,'ACTIVE');
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'MEMBER_ADDED',p_member);
 RETURN p_member;
END $$;
CREATE FUNCTION musitu.add_resource(p_actor text,p_resource uuid,p_label text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role IN ('OWNER','ADMIN') AND m.status='ACTIVE' AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_resource IS NULL OR p_label IS NULL OR length(trim(p_label)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_RESOURCE'; END IF;
 INSERT INTO musitu.resources(tenant_id,resource_id,label) VALUES(scope,p_resource,p_label);
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'RESOURCE_ADDED',p_resource::text);
 RETURN p_resource;
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.add_staff(text,text,text) OWNER TO musitu_commands;
ALTER FUNCTION musitu.add_resource(text,uuid,text) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.add_staff(text,text,text),musitu.add_resource(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.add_staff(text,text,text),musitu.add_resource(text,uuid,text) TO musitu_runtime;
COMMIT;
