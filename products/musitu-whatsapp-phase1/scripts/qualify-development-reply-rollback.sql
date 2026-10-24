-- Run inside an owner transaction and ROLLBACK afterward. NO provider traffic.
-- Temporary synthetic owner/source/consent/review fixtures are NOT real approval.
SET LOCAL statement_timeout='8s';
SELECT set_config('app.tenant_id','986eb904-7296-46a9-9e9b-94074db9b547',true);
DO $$ BEGIN
 IF current_database()<>'musitu_whatsapp_phase1' OR current_user<>'musitu_whatsapp_phase1_owner' THEN RAISE EXCEPTION 'QUALIFICATION_TARGET_REJECTED'; END IF;
END $$;
INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES('986eb904-7296-46a9-9e9b-94074db9b547','395558180472062118','OWNER','ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO musitu.conversations(tenant_id,conversation_id,phone_number_id,remote_wa_id,handling_mode)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','fe000000-0000-4000-8000-000000000001','1292923853915392','hmac256:'||repeat('9',64),'HUMAN');
INSERT INTO musitu.contacts(tenant_id,phone_number_id,remote_hash,encrypted_recipient)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','1292923853915392','hmac256:'||repeat('9',64),'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.QQ');
INSERT INTO musitu.inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','1292923853915392','wamid.SQL_ROLLBACK_QUALIFICATION','fe000000-0000-4000-8000-000000000001',repeat('9',64),now()-interval '1 minute');
INSERT INTO musitu.messages(tenant_id,phone_number_id,provider_message_id,conversation_id,encrypted_body)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','1292923853915392','wamid.SQL_ROLLBACK_QUALIFICATION','fe000000-0000-4000-8000-000000000001','v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.QQ');
INSERT INTO musitu.conversations(tenant_id,conversation_id,phone_number_id,remote_wa_id,handling_mode)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','fe000000-0000-4000-8000-000000000003','1292923853915392','hmac256:'||repeat('8',64),'HUMAN'),
('986eb904-7296-46a9-9e9b-94074db9b547','fe000000-0000-4000-8000-000000000004','1292923853915392','hmac256:'||repeat('7',64),'HUMAN');
INSERT INTO musitu.inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','1292923853915392','wamid.SQL_ROLLBACK_EXPIRED','fe000000-0000-4000-8000-000000000003',repeat('8',64),now()-interval '2 days');
INSERT INTO musitu.customer_suppressions(tenant_id,conversation_id,phone_number_id,remote_wa_id,source_provider_message_id)
VALUES('986eb904-7296-46a9-9e9b-94074db9b547','fe000000-0000-4000-8000-000000000004','1292923853915392','hmac256:'||repeat('7',64),'wamid.SQL_ROLLBACK_STOP');
SET LOCAL ROLE musitu_runtime;
DO $$
DECLARE a uuid:='fe000000-0000-4000-8000-000000000002'; c uuid:='fe000000-0000-4000-8000-000000000001'; r jsonb; tests jsonb:='[]'; body text:='v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.QQ';
BEGIN
 IF current_user<>'musitu_runtime' OR (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'RUNTIME_IDENTITY_REJECTED'; END IF;
 IF has_any_column_privilege(current_user,'musitu.outbound_attempts','INSERT') OR has_any_column_privilege(current_user,'musitu.outbound_attempts','UPDATE') OR has_any_column_privilege(current_user,'musitu.channel_consent_evidence','INSERT') THEN RAISE EXCEPTION 'RUNTIME_WRITE_CEILING_FAILED'; END IF;
 tests:=tests||'"runtime_identity_and_effective_write_ceiling"'::jsonb;
 BEGIN
  UPDATE musitu.outbound_attempts SET status='ACCEPTED' WHERE tenant_id='986eb904-7296-46a9-9e9b-94074db9b547';
  RAISE EXCEPTION 'DIRECT_UPDATE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN tests:=tests||'"direct_outbound_update_denied"'::jsonb; END;
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',a,body,repeat('a',64),false,true);
  RAISE EXCEPTION 'MISSING_APPROVAL_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_REVIEW_REQUIRED' THEN RAISE; END IF;tests:=tests||'"explicit_text_approval_required"'::jsonb;END;
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',a,body,repeat('a',64),true,false);
  RAISE EXCEPTION 'MISSING_CONSENT_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_REVIEW_REQUIRED' THEN RAISE; END IF;tests:=tests||'"owner_self_test_consent_required"'::jsonb;END;
 BEGIN
  PERFORM musitu.reserve_development_reply('395706056631686016',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',a,body,repeat('a',64),true,true);
  RAISE EXCEPTION 'OTHER_ACTOR_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_REVIEW_REQUIRED' THEN RAISE; END IF;tests:=tests||'"other_actor_denied"'::jsonb;END;
 PERFORM set_config('app.tenant_id','f7453f47-9790-4ae9-8661-61ea8cad9300',true);
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',a,body,repeat('a',64),true,true);
  RAISE EXCEPTION 'OTHER_TENANT_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_REVIEW_REQUIRED' THEN RAISE; END IF;tests:=tests||'"other_tenant_denied"'::jsonb;END;
 PERFORM set_config('app.tenant_id','986eb904-7296-46a9-9e9b-94074db9b547',true);
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118','fe000000-0000-4000-8000-000000000003','wamid.SQL_ROLLBACK_EXPIRED','qa-expired',gen_random_uuid(),body,repeat('a',64),true,true);
  RAISE EXCEPTION 'EXPIRED_SESSION_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SESSION_WINDOW_CLOSED' THEN RAISE; END IF;tests:=tests||'"expired_signed_session_denied"'::jsonb;END;
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118','fe000000-0000-4000-8000-000000000004','wamid.SQL_ROLLBACK_STOP','qa-stop',gen_random_uuid(),body,repeat('a',64),true,true);
  RAISE EXCEPTION 'SUPPRESSED_CONVERSATION_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTOMER_OPT_OUT' THEN RAISE; END IF;tests:=tests||'"suppressed_conversation_denied"'::jsonb;END;
 IF has_function_privilege('musitu_ingress','musitu.reserve_development_reply(text,uuid,text,text,uuid,text,text,boolean,boolean)','EXECUTE') OR has_function_privilege('musitu_ingress','musitu.complete_development_reply(text,uuid,text,text,integer)','EXECUTE') THEN RAISE EXCEPTION 'INGRESS_CAN_SEND'; END IF;
 tests:=tests||'"ingress_send_function_authority_denied"'::jsonb;
 r:=musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',a,body,repeat('a',64),true,true);
 IF r->>'admitted'<>'true' OR NOT EXISTS(SELECT 1 FROM musitu.outbound_attempts WHERE attempt_id=a AND status='UNKNOWN' AND provider_message_id IS NULL) THEN RAISE EXCEPTION 'DURABLE_RESERVATION_FAILED'; END IF;
 tests:=tests||'"native_reservation_unknown_before_transport"'::jsonb;
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_ALTERNATE','qa-alternate',gen_random_uuid(),body,repeat('a',64),true,true);
  RAISE EXCEPTION 'UNKNOWN_GATE_BYPASSED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_UNCERTAIN_ATTEMPT' THEN RAISE; END IF;tests:=tests||'"unknown_attempt_blocks_new_submission"'::jsonb;END;
 r:=musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','qa',gen_random_uuid(),body,repeat('a',64),true,true);
 IF r->>'admitted'<>'false' OR r->>'status'<>'UNKNOWN' THEN RAISE EXCEPTION 'REPLAY_ADMITTED'; END IF;
 tests:=tests||'"same_key_replay_consumed_without_resend"'::jsonb;
 BEGIN
  PERFORM musitu.reserve_development_reply('395558180472062118',c,'wamid.SQL_ROLLBACK_QUALIFICATION','newkey',gen_random_uuid(),body,repeat('a',64),true,true);
  RAISE EXCEPTION 'DUPLICATE_SOURCE_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEVELOPMENT_REPLY_CONFLICT' THEN RAISE; END IF;tests:=tests||'"new_key_same_inbound_denied"'::jsonb;END;
 BEGIN
  PERFORM musitu.complete_development_reply('395558180472062118',a,'ACCEPTED','wamid.QA_RESULT',429);
  RAISE EXCEPTION 'FALSE_ACCEPTED_ALLOWED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_DEVELOPMENT_OUTCOME' THEN RAISE; END IF;tests:=tests||'"false_acceptance_denied"'::jsonb;END;
 r:=musitu.complete_development_reply('395558180472062118',a,'ACCEPTED','wamid.QA_RESULT',200);
 IF r->>'status'<>'ACCEPTED' OR (SELECT provider_message_id FROM musitu.outbound_attempts WHERE attempt_id=a)<>'wamid.QA_RESULT' THEN RAISE EXCEPTION 'OUTCOME_BINDING_FAILED'; END IF;
 tests:=tests||'"native_provider_id_binding_and_outcome"'::jsonb;
 IF NOT EXISTS(SELECT 1 FROM musitu.action_audit WHERE reference_id=a::text AND action='DEVELOPMENT_SELF_TEST_REPLY_APPROVED_AND_RESERVED') OR NOT EXISTS(SELECT 1 FROM musitu.action_audit WHERE reference_id=a::text AND action='DEVELOPMENT_REPLY_OUTCOME_RECORDED') THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
 tests:=tests||'"approval_and_outcome_audit_present"'::jsonb;
 PERFORM set_config('qa.development_reply_results',jsonb_build_object('scope','REAL_POSTGRES_RUNTIME_SYNTHETIC_ROLLBACK_NO_META_NO_IDP','passed',jsonb_array_length(tests),'tests',tests,'fixturesCommitted',false)::text,true);
END $$;
RESET ROLE;
SELECT current_setting('qa.development_reply_results',true)::jsonb AS qualification;
-- Caller must ROLLBACK; never COMMIT these synthetic review fixtures.
