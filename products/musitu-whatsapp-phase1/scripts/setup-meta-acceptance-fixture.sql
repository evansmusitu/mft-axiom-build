-- Administrative fixture only: this is not owner login or onboarding acceptance.
-- Run only in the named disposable Neon qualification database. No memberships,
-- customer imports, provider sends or production configuration are created.
DO $fixture$
BEGIN
 IF current_database()<>'musitu_whatsapp_phase1' OR current_user<>'musitu_whatsapp_phase1_owner' THEN RAISE EXCEPTION 'ACCEPTANCE_DATABASE_OWNER_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.whatsapp_channels WHERE phone_number_id='1292923853915392' AND (tenant_id<>'986eb904-7296-46a9-9e9b-94074db9b547'::uuid OR waba_id<>'1955690452095441' OR status<>'VERIFIED')) THEN RAISE EXCEPTION 'CHANNEL_ALREADY_BOUND'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.tenants WHERE id='986eb904-7296-46a9-9e9b-94074db9b547' AND (legal_name<>'MUSITU Meta Acceptance Test - Synthetic Business' OR status<>'ACTIVE')) THEN RAISE EXCEPTION 'ACCEPTANCE_TENANT_CONFLICT'; END IF;
 INSERT INTO musitu.tenants(id,legal_name,status) VALUES('986eb904-7296-46a9-9e9b-94074db9b547','MUSITU Meta Acceptance Test - Synthetic Business','ACTIVE') ON CONFLICT DO NOTHING;
 INSERT INTO musitu.business_configuration(tenant_id,timezone,business_description) VALUES('986eb904-7296-46a9-9e9b-94074db9b547','Africa/Harare','Synthetic private acceptance tenant. Owner-controlled test messages only; no approved business facts, customer imports or automatic sending.') ON CONFLICT DO NOTHING;
 INSERT INTO musitu.whatsapp_channels(tenant_id,waba_id,phone_number_id,status) VALUES('986eb904-7296-46a9-9e9b-94074db9b547','1955690452095441','1292923853915392','VERIFIED') ON CONFLICT DO NOTHING;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) SELECT '986eb904-7296-46a9-9e9b-94074db9b547','qualification-admin','ADMIN_ACCEPTANCE_FIXTURE','1096094346481018'
 WHERE NOT EXISTS(SELECT 1 FROM musitu.action_audit WHERE tenant_id='986eb904-7296-46a9-9e9b-94074db9b547' AND action='ADMIN_ACCEPTANCE_FIXTURE' AND reference_id='1096094346481018');
END
$fixture$;
