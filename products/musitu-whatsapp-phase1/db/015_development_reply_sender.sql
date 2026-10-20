-- Additive, exact MUSITU development tenant/channel/owner only.
-- Human self-test consent is an explicit assertion in the authenticated review.
-- No existing offline FAQ preparation becomes a sending queue.
BEGIN;
ALTER TABLE musitu.outbound_attempts
 ADD COLUMN dev_conversation_id uuid,
 ADD COLUMN dev_source_message_id text,
 ADD COLUMN dev_request_key text,
 ADD COLUMN dev_review_actor text,
 ADD COLUMN dev_encrypted_body text,
 ADD COLUMN dev_body_digest text,
 ADD COLUMN dev_reviewed_at timestamptz,
 ADD COLUMN dev_retained_until timestamptz,
 ADD COLUMN dev_http_status integer,
 ADD COLUMN dev_outcome_recorded_at timestamptz,
 ADD CONSTRAINT dev_reply_conversation_fk FOREIGN KEY(tenant_id,dev_conversation_id) REFERENCES musitu.conversations(tenant_id,conversation_id),
 ADD CONSTRAINT dev_reply_source_fk FOREIGN KEY(tenant_id,channel_phone_number_id,dev_source_message_id) REFERENCES musitu.inbound_events(tenant_id,phone_number_id,provider_message_id),
 ADD CONSTRAINT dev_reply_review_fk FOREIGN KEY(tenant_id,dev_review_actor) REFERENCES musitu.memberships(tenant_id,actor_id),
 ADD CONSTRAINT dev_reply_source_once UNIQUE(tenant_id,channel_phone_number_id,dev_source_message_id),
 ADD CONSTRAINT dev_reply_key_once UNIQUE(tenant_id,dev_request_key),
 ADD CONSTRAINT dev_reply_record_valid CHECK(dev_conversation_id IS NULL OR (
  tenant_id='986eb904-7296-46a9-9e9b-94074db9b547'::uuid AND channel_phone_number_id='1292923853915392'
  AND dev_source_message_id IS NOT NULL AND dev_review_actor='395558180472062118'
  AND dev_request_key ~ '^[A-Za-z0-9_-]{1,100}$'
  AND dev_encrypted_body ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  AND length(dev_encrypted_body)<=1500 AND dev_body_digest ~ '^[a-f0-9]{64}$'
  AND dev_reviewed_at IS NOT NULL AND dev_retained_until=dev_reviewed_at+interval '30 days') IS TRUE),
 ADD CONSTRAINT dev_reply_http_valid CHECK(dev_http_status IS NULL OR dev_http_status BETWEEN 100 AND 599);
-- Privileges only to the existing non-login, non-BYPASSRLS command identity.
GRANT SELECT ON musitu.contacts,musitu.messages,musitu.outbound_attempts TO musitu_commands;
GRANT INSERT(tenant_id,attempt_id,effect_key,channel_phone_number_id,status,recipient_hash,
 dev_conversation_id,dev_source_message_id,dev_request_key,dev_review_actor,dev_encrypted_body,dev_body_digest,dev_reviewed_at,dev_retained_until)
 ON musitu.outbound_attempts TO musitu_commands;
GRANT UPDATE(status,provider_message_id,dev_http_status,dev_outcome_recorded_at) ON musitu.outbound_attempts TO musitu_commands;
GRANT INSERT(tenant_id,phone_number_id,recipient_hash,scope,status,evidence_ref,confirmed_at,expires_at) ON musitu.channel_consent_evidence TO musitu_commands;
GRANT UPDATE(scope,status,evidence_ref,confirmed_at,expires_at) ON musitu.channel_consent_evidence TO musitu_commands;

CREATE FUNCTION musitu.reserve_development_reply(p_actor text,p_conversation uuid,p_message text,p_key text,p_attempt uuid,p_encrypted text,p_digest text,p_approved boolean,p_self_test_consent boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; convo musitu.conversations; msg musitu.inbound_events; prior musitu.outbound_attempts; contact musitu.contacts; reviewed timestamptz:=clock_timestamp();
BEGIN
 IF scope IS DISTINCT FROM '986eb904-7296-46a9-9e9b-94074db9b547'::uuid OR p_actor IS DISTINCT FROM '395558180472062118' OR p_approved IS NOT TRUE OR p_self_test_consent IS NOT TRUE THEN RAISE EXCEPTION 'DEVELOPMENT_REVIEW_REQUIRED'; END IF;
 IF p_attempt IS NULL OR p_conversation IS NULL OR p_message IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,100}$' OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR p_encrypted IS NULL OR length(p_encrypted)>1500 OR p_encrypted !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'INVALID_DEVELOPMENT_REPLY'; END IF;
 -- Tenant lock serializes the daily budget and UNKNOWN gate across conversations.
 PERFORM 1 FROM musitu.tenants WHERE id=scope AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM musitu.memberships WHERE tenant_id=scope AND actor_id=p_actor AND role='OWNER' AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO convo FROM musitu.conversations WHERE tenant_id=scope AND conversation_id=p_conversation AND phone_number_id='1292923853915392' AND handling_mode='HUMAN' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVELOPMENT_CONVERSATION_UNAVAILABLE'; END IF;
 PERFORM 1 FROM musitu.whatsapp_channels WHERE tenant_id=scope AND phone_number_id=convo.phone_number_id AND waba_id='1955690452095441' AND status='VERIFIED' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVELOPMENT_CHANNEL_UNAVAILABLE'; END IF;
 reviewed:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM musitu.customer_suppressions WHERE tenant_id=scope AND conversation_id=p_conversation) THEN RAISE EXCEPTION 'CUSTOMER_OPT_OUT'; END IF;
 SELECT * INTO prior FROM musitu.outbound_attempts WHERE tenant_id=scope AND (dev_request_key=p_key OR (channel_phone_number_id=convo.phone_number_id AND dev_source_message_id=p_message)) ORDER BY attempt_id LIMIT 1;
 IF FOUND THEN
  IF prior.dev_request_key<>p_key OR prior.dev_source_message_id<>p_message OR prior.dev_conversation_id<>p_conversation OR prior.dev_body_digest<>p_digest OR prior.dev_review_actor<>p_actor THEN RAISE EXCEPTION 'DEVELOPMENT_REPLY_CONFLICT'; END IF;
  RETURN jsonb_build_object('admitted',false,'attemptId',prior.attempt_id,'status',prior.status);
 END IF;
 IF EXISTS(SELECT 1 FROM musitu.outbound_attempts WHERE tenant_id=scope AND status IN('RESERVED','UNKNOWN')) THEN RAISE EXCEPTION 'DEVELOPMENT_UNCERTAIN_ATTEMPT'; END IF;
 IF (SELECT count(*) FROM musitu.outbound_attempts WHERE tenant_id=scope AND dev_reviewed_at>=date_trunc('day',reviewed AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=5 THEN RAISE EXCEPTION 'DEVELOPMENT_DAILY_LIMIT'; END IF;
 SELECT * INTO msg FROM musitu.inbound_events WHERE tenant_id=scope AND conversation_id=p_conversation AND phone_number_id=convo.phone_number_id ORDER BY provider_sent_at DESC NULLS LAST,received_at DESC LIMIT 1;
 IF NOT FOUND OR msg.provider_message_id<>p_message OR msg.provider_sent_at IS NULL OR msg.provider_sent_at>reviewed OR msg.provider_sent_at<reviewed-interval '23 hours 55 minutes' THEN RAISE EXCEPTION 'SESSION_WINDOW_CLOSED'; END IF;
 PERFORM 1 FROM musitu.messages WHERE tenant_id=scope AND phone_number_id=convo.phone_number_id AND provider_message_id=p_message AND conversation_id=p_conversation AND retained_until>reviewed;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVELOPMENT_SOURCE_UNAVAILABLE'; END IF;
 SELECT * INTO contact FROM musitu.contacts WHERE tenant_id=scope AND phone_number_id=convo.phone_number_id AND remote_hash=convo.remote_wa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVELOPMENT_RECIPIENT_UNAVAILABLE'; END IF;
 -- Explicit owner self-test assertion, not a customer import or inferred opt-in.
 INSERT INTO musitu.channel_consent_evidence(tenant_id,phone_number_id,recipient_hash,scope,status,evidence_ref,confirmed_at,expires_at)
 VALUES(scope,convo.phone_number_id,convo.remote_wa_id,'CUSTOMER_SERVICE','GRANTED','authenticated-owner-self-test:'||p_attempt,reviewed,reviewed+interval '1 hour')
 ON CONFLICT(tenant_id,phone_number_id,recipient_hash) DO UPDATE SET status='GRANTED',scope='CUSTOMER_SERVICE',evidence_ref=EXCLUDED.evidence_ref,confirmed_at=EXCLUDED.confirmed_at,expires_at=EXCLUDED.expires_at;
 INSERT INTO musitu.outbound_attempts(tenant_id,attempt_id,effect_key,channel_phone_number_id,status,recipient_hash,dev_conversation_id,dev_source_message_id,dev_request_key,dev_review_actor,dev_encrypted_body,dev_body_digest,dev_reviewed_at,dev_retained_until)
 VALUES(scope,p_attempt,'development-reply:'||p_key,convo.phone_number_id,'UNKNOWN',convo.remote_wa_id,p_conversation,p_message,p_key,p_actor,p_encrypted,p_digest,reviewed,reviewed+interval '30 days');
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'DEVELOPMENT_SELF_TEST_REPLY_APPROVED_AND_RESERVED',p_attempt::text);
 RETURN jsonb_build_object('admitted',true,'attemptId',p_attempt,'phoneNumberId',convo.phone_number_id,'recipientHash',convo.remote_wa_id,'encryptedRecipient',contact.encrypted_recipient,'encryptedBody',p_encrypted,'bodyDigest',p_digest);
END $$;

CREATE FUNCTION musitu.complete_development_reply(p_actor text,p_attempt uuid,p_status text,p_provider text,p_http integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; prior musitu.outbound_attempts;
BEGIN
 IF scope IS DISTINCT FROM '986eb904-7296-46a9-9e9b-94074db9b547'::uuid OR p_actor IS DISTINCT FROM '395558180472062118' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO prior FROM musitu.outbound_attempts WHERE tenant_id=scope AND attempt_id=p_attempt AND dev_review_actor=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_status IS NULL OR p_status NOT IN('UNKNOWN','ACCEPTED','FAILED') OR (p_http IS NOT NULL AND p_http NOT BETWEEN 100 AND 599) THEN RAISE EXCEPTION 'INVALID_DEVELOPMENT_OUTCOME'; END IF;
 IF (p_status='ACCEPTED' AND (p_http IS DISTINCT FROM 200 OR p_provider IS NULL OR p_provider !~ '^wamid\.[A-Za-z0-9._~-]{1,180}$')) OR (p_status<>'ACCEPTED' AND p_provider IS NOT NULL) OR (p_status='FAILED' AND (p_http IS NULL OR p_http NOT BETWEEN 400 AND 499 OR p_http IN(408,429))) THEN RAISE EXCEPTION 'INVALID_DEVELOPMENT_OUTCOME'; END IF;
 IF prior.dev_outcome_recorded_at IS NOT NULL THEN RETURN jsonb_build_object('status',prior.status,'idempotent',true); END IF;
 IF prior.status<>'UNKNOWN' OR prior.provider_message_id IS NOT NULL THEN RAISE EXCEPTION 'DEVELOPMENT_OUTCOME_CONFLICT'; END IF;
 UPDATE musitu.outbound_attempts SET status=p_status,provider_message_id=p_provider,dev_http_status=p_http,dev_outcome_recorded_at=clock_timestamp() WHERE tenant_id=scope AND attempt_id=p_attempt;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'DEVELOPMENT_REPLY_OUTCOME_RECORDED',p_attempt::text);
 RETURN jsonb_build_object('status',p_status,'idempotent',false);
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.reserve_development_reply(text,uuid,text,text,uuid,text,text,boolean,boolean) OWNER TO musitu_commands;
ALTER FUNCTION musitu.complete_development_reply(text,uuid,text,text,integer) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.reserve_development_reply(text,uuid,text,text,uuid,text,text,boolean,boolean),musitu.complete_development_reply(text,uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.reserve_development_reply(text,uuid,text,text,uuid,text,text,boolean,boolean),musitu.complete_development_reply(text,uuid,text,text,integer) TO musitu_runtime;
COMMIT;
