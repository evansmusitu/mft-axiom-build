-- Trusted operator binding of the existing, previously authenticated owner.
-- This is NOT a browser login, consent assertion, reply approval or send.
DO $$
DECLARE target uuid:='986eb904-7296-46a9-9e9b-94074db9b547'; owner_id text:='395558180472062118';
BEGIN
 IF current_database()<>'musitu_whatsapp_phase1' OR current_user<>'musitu_whatsapp_phase1_owner' THEN RAISE EXCEPTION 'ACCEPTANCE_DATABASE_OWNER_REQUIRED'; END IF;
 PERFORM set_config('app.tenant_id','f7453f47-9790-4ae9-8661-61ea8cad9300',true);
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships WHERE tenant_id='f7453f47-9790-4ae9-8661-61ea8cad9300' AND actor_id=owner_id AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'EXISTING_OWNER_REQUIRED'; END IF;
 PERFORM set_config('app.tenant_id',target::text,true);
 IF NOT EXISTS(SELECT 1 FROM musitu.tenants WHERE id=target AND legal_name='MUSITU Meta Acceptance Test - Synthetic Business' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM musitu.whatsapp_channels WHERE tenant_id=target AND waba_id='1955690452095441' AND phone_number_id='1292923853915392' AND status='VERIFIED') THEN RAISE EXCEPTION 'EXACT_DEVELOPMENT_FIXTURE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.memberships WHERE tenant_id=target AND (actor_id<>owner_id OR role<>'OWNER' OR status<>'ACTIVE')) THEN RAISE EXCEPTION 'DEVELOPMENT_MEMBERSHIP_CONFLICT'; END IF;
 INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES(target,owner_id,'OWNER','ACTIVE') ON CONFLICT DO NOTHING;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id)
 SELECT target,'qualification-admin','ADMIN_BIND_PREEXISTING_OWNER',owner_id
 WHERE NOT EXISTS(SELECT 1 FROM musitu.action_audit WHERE tenant_id=target AND action='ADMIN_BIND_PREEXISTING_OWNER' AND reference_id=owner_id);
END $$;
