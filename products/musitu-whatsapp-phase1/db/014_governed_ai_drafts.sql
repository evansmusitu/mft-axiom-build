-- Additive, isolated staging only. Every model reservation consumes quota,
-- including failures. No automatic expiry/retry of uncertain requests.
BEGIN;
CREATE TABLE musitu.ai_policy(
 tenant_id uuid PRIMARY KEY REFERENCES musitu.tenants(id),
 enabled boolean NOT NULL DEFAULT false,
 daily_limit integer NOT NULL DEFAULT 5 CHECK(daily_limit BETWEEN 1 AND 5)
);
CREATE TABLE musitu.ai_requests(
 tenant_id uuid NOT NULL REFERENCES musitu.tenants(id), request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_id text NOT NULL, conversation_id uuid NOT NULL, phone_number_id text NOT NULL, provider_message_id text NOT NULL,
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','COMPLETED','UNKNOWN')),
 context_hash text NOT NULL, usage jsonb, result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz,
 PRIMARY KEY(tenant_id,request_id), UNIQUE(tenant_id,phone_number_id,provider_message_id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES musitu.conversations(tenant_id,conversation_id),
 FOREIGN KEY(tenant_id,phone_number_id,provider_message_id) REFERENCES musitu.messages(tenant_id,phone_number_id,provider_message_id)
);
ALTER TABLE musitu.ai_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.ai_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE musitu.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.ai_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.ai_policy
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_boundary ON musitu.ai_requests
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.ai_policy,musitu.ai_requests FROM PUBLIC;
GRANT SELECT ON musitu.ai_policy,musitu.ai_requests TO musitu_runtime;
GRANT SELECT,INSERT,UPDATE ON musitu.ai_policy,musitu.ai_requests TO musitu_commands;
GRANT SELECT ON musitu.messages TO musitu_commands;
GRANT INSERT ON musitu.reply_drafts TO musitu_commands;

CREATE FUNCTION musitu.configure_ai(p_actor text,p_enabled boolean) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 PERFORM 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role='OWNER' AND m.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'AI_POLICY_INVALID'; END IF;
 INSERT INTO musitu.ai_policy(tenant_id,enabled) VALUES(scope,p_enabled) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,CASE WHEN p_enabled THEN 'AI_ASSISTANCE_ENABLED' ELSE 'AI_ASSISTANCE_DISABLED' END,'groq/openai/gpt-oss-20b');
 RETURN p_enabled;
END $$;

CREATE FUNCTION musitu.reserve_ai_draft(p_actor text,p_conversation uuid,p_phone text,p_message text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; policy musitu.ai_policy; prior musitu.ai_requests; msg musitu.messages; facts jsonb; rid uuid;
BEGIN
 PERFORM 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role IN('OWNER','ADMIN','AGENT') AND m.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO policy FROM musitu.ai_policy WHERE tenant_id=scope FOR UPDATE;
 IF NOT FOUND OR NOT policy.enabled THEN RAISE EXCEPTION 'AI_ASSISTANCE_DISABLED'; END IF;
 PERFORM 1 FROM musitu.conversations c WHERE c.tenant_id=scope AND c.conversation_id=p_conversation AND c.phone_number_id=p_phone AND c.handling_mode='BOT' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_CONVERSATION_UNAVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.customer_suppressions WHERE tenant_id=scope AND conversation_id=p_conversation) THEN RAISE EXCEPTION 'CUSTOMER_OPT_OUT'; END IF;
 SELECT * INTO prior FROM musitu.ai_requests WHERE tenant_id=scope AND phone_number_id=p_phone AND provider_message_id=p_message;
 IF FOUND THEN
  IF prior.conversation_id<>p_conversation THEN RAISE EXCEPTION 'AI_MESSAGE_CONFLICT'; END IF;
  RETURN jsonb_build_object('admitted',false,'state',prior.state,'requestId',prior.request_id,'result',prior.result);
 END IF;
 IF EXISTS(SELECT 1 FROM musitu.ai_requests WHERE tenant_id=scope AND state IN('RESERVED','UNKNOWN')) THEN RAISE EXCEPTION 'AI_UNCERTAIN_REQUEST'; END IF;
 IF (SELECT count(*) FROM musitu.ai_requests WHERE tenant_id=scope AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=policy.daily_limit THEN RAISE EXCEPTION 'AI_DAILY_LIMIT'; END IF;
 SELECT * INTO msg FROM musitu.messages WHERE tenant_id=scope AND phone_number_id=p_phone AND provider_message_id=p_message AND conversation_id=p_conversation AND retained_until>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_MESSAGE_UNAVAILABLE'; END IF;
 SELECT jsonb_agg(jsonb_build_object('faqId',faq_id,'question',normalized_question,'answer',answer) ORDER BY faq_id) INTO facts FROM musitu.faqs WHERE tenant_id=scope;
 IF facts IS NULL OR jsonb_array_length(facts)>30 THEN RAISE EXCEPTION 'AI_KNOWLEDGE_UNAVAILABLE'; END IF;
 INSERT INTO musitu.ai_requests(tenant_id,actor_id,conversation_id,phone_number_id,provider_message_id,context_hash) VALUES(scope,p_actor,p_conversation,p_phone,p_message,encode(sha256(convert_to(facts::text,'UTF8')),'hex')) RETURNING request_id INTO rid;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'AI_REQUEST_RESERVED',rid::text);
 RETURN jsonb_build_object('admitted',true,'requestId',rid,'encryptedBody',msg.encrypted_body,'faqs',facts);
END $$;

CREATE FUNCTION musitu.complete_ai_draft(p_actor text,p_request uuid,p_source uuid,p_usage jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; req musitu.ai_requests; facts jsonb; source musitu.faqs; did uuid; output jsonb; uncertain boolean;
BEGIN
 PERFORM 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role IN('OWNER','ADMIN','AGENT') AND m.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM musitu.ai_policy WHERE tenant_id=scope AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ASSISTANCE_DISABLED'; END IF;
 SELECT * INTO req FROM musitu.ai_requests WHERE tenant_id=scope AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR req.actor_id<>p_actor THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF req.state<>'RESERVED' THEN RETURN req.result; END IF;
 IF p_usage IS NULL OR jsonb_typeof(p_usage) IS DISTINCT FROM 'object' OR NOT(p_usage ?& ARRAY['attempts','inputTokens','outputTokens','totalTokens','outcome','httpStatus']) OR (p_usage-ARRAY['attempts','inputTokens','outputTokens','totalTokens','outcome','httpStatus'])<>'{}'::jsonb OR jsonb_typeof(p_usage->'attempts') IS DISTINCT FROM 'number' OR (p_usage->>'attempts') NOT IN('0','1') OR jsonb_typeof(p_usage->'outcome') IS DISTINCT FROM 'string' OR (p_usage->>'outcome') NOT IN('PRECHECK_HANDOVER','RESPONSE_PARSED','TIMEOUT','HTTP_ERROR','RATE_LIMIT','INVALID_RESPONSE','ERROR') THEN RAISE EXCEPTION 'AI_USAGE_INVALID'; END IF;
 uncertain:=p_usage->'totalTokens'='null'::jsonb;
 IF uncertain THEN
  IF p_usage->>'attempts'<>'1' OR p_usage->'inputTokens'<>'null'::jsonb OR p_usage->'outputTokens'<>'null'::jsonb THEN RAISE EXCEPTION 'AI_USAGE_INVALID'; END IF;
 ELSE
  IF NOT ((p_usage->>'inputTokens') ~ '^[0-9]{1,10}$' AND (p_usage->>'outputTokens') ~ '^[0-9]{1,10}$' AND (p_usage->>'totalTokens') ~ '^[0-9]{1,10}$') OR jsonb_typeof(p_usage->'inputTokens') IS DISTINCT FROM 'number' OR jsonb_typeof(p_usage->'outputTokens') IS DISTINCT FROM 'number' OR jsonb_typeof(p_usage->'totalTokens') IS DISTINCT FROM 'number' OR (p_usage->>'inputTokens')::bigint+(p_usage->>'outputTokens')::bigint<>(p_usage->>'totalTokens')::bigint THEN RAISE EXCEPTION 'AI_USAGE_INVALID'; END IF;
 END IF;
 PERFORM 1 FROM musitu.conversations WHERE tenant_id=scope AND conversation_id=req.conversation_id AND handling_mode='BOT' FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM musitu.customer_suppressions WHERE tenant_id=scope AND conversation_id=req.conversation_id) THEN RAISE EXCEPTION 'AI_CONVERSATION_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM musitu.messages WHERE tenant_id=scope AND phone_number_id=req.phone_number_id AND provider_message_id=req.provider_message_id AND retained_until>now()) THEN RAISE EXCEPTION 'AI_MESSAGE_UNAVAILABLE'; END IF;
 SELECT jsonb_agg(jsonb_build_object('faqId',faq_id,'question',normalized_question,'answer',answer) ORDER BY faq_id) INTO facts FROM musitu.faqs WHERE tenant_id=scope;
 IF encode(sha256(convert_to(facts::text,'UTF8')),'hex') IS DISTINCT FROM req.context_hash THEN RAISE EXCEPTION 'AI_KNOWLEDGE_CHANGED'; END IF;
 IF p_source IS NOT NULL AND NOT uncertain AND p_usage->>'outcome'='RESPONSE_PARSED' THEN
  SELECT * INTO source FROM musitu.faqs WHERE tenant_id=scope AND faq_id=p_source FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_REJECTED'; END IF;
  INSERT INTO musitu.reply_drafts(tenant_id,draft_id,conversation_id,effect_key,normalized_question,source_faq_id,body) VALUES(scope,gen_random_uuid(),req.conversation_id,'ai:'||req.request_id,source.normalized_question,source.faq_id,source.answer) RETURNING draft_id INTO did;
  output:=jsonb_build_object('requestId',p_request,'status','DRAFT','draftId',did,'requiresHumanApproval',true,'providerDelivery','NEVER_SUBMITTED');
 ELSE
  PERFORM musitu.handover(p_actor,req.conversation_id);
  output:=jsonb_build_object('requestId',p_request,'status','HANDOVER_REQUIRED','requiresHumanApproval',true,'providerDelivery','NEVER_SUBMITTED');
 END IF;
 UPDATE musitu.ai_requests SET state=CASE WHEN uncertain THEN 'UNKNOWN' ELSE 'COMPLETED' END,usage=p_usage,result=output,completed_at=clock_timestamp() WHERE tenant_id=scope AND request_id=p_request;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,CASE WHEN uncertain THEN 'AI_USAGE_UNKNOWN' ELSE 'AI_RESULT_RECORDED' END,p_request::text);
 RETURN output;
END $$;
-- Row locks need UPDATE permissions only for the constrained non-login owner.
GRANT UPDATE(status) ON musitu.tenants TO musitu_commands;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.configure_ai(text,boolean) OWNER TO musitu_commands;
ALTER FUNCTION musitu.reserve_ai_draft(text,uuid,text,text) OWNER TO musitu_commands;
ALTER FUNCTION musitu.complete_ai_draft(text,uuid,uuid,jsonb) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.configure_ai(text,boolean),musitu.reserve_ai_draft(text,uuid,text,text),musitu.complete_ai_draft(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.configure_ai(text,boolean),musitu.reserve_ai_draft(text,uuid,text,text),musitu.complete_ai_draft(text,uuid,uuid,jsonb) TO musitu_runtime;
COMMIT;
