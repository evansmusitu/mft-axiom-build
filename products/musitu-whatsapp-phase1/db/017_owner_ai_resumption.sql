-- Owner-confirmed draft assistance. No outbound, suppression or consent change.
BEGIN;
CREATE FUNCTION musitu.resume_ai_assistance(p_actor text,p_conversation uuid,p_confirm_review_only boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
-- MUSITU_OWNER_AI_RESUMPTION_V17
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; prior text;
BEGIN
 PERFORM 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.role='OWNER' AND m.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF m,t;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_confirm_review_only IS DISTINCT FROM true THEN RAISE EXCEPTION 'AI_RESUMPTION_CONFIRMATION_REQUIRED'; END IF;
 PERFORM 1 FROM musitu.ai_policy WHERE tenant_id=scope AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ASSISTANCE_DISABLED'; END IF;
 SELECT handling_mode INTO prior FROM musitu.conversations WHERE tenant_id=scope AND conversation_id=p_conversation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSATION_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.customer_suppressions WHERE tenant_id=scope AND conversation_id=p_conversation) THEN RAISE EXCEPTION 'CUSTOMER_OPT_OUT'; END IF;
 IF EXISTS(SELECT 1 FROM musitu.ai_requests WHERE tenant_id=scope AND state IN('RESERVED','UNKNOWN')) THEN RAISE EXCEPTION 'AI_UNCERTAIN_REQUEST'; END IF;
 IF prior='BOT' THEN RETURN jsonb_build_object('conversationId',p_conversation,'mode','BOT','changed',false,'reviewOnly',true,'providerDelivery','NEVER_SUBMITTED'); END IF;
 UPDATE musitu.conversations SET handling_mode='BOT' WHERE tenant_id=scope AND conversation_id=p_conversation;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'AI_ASSISTANCE_RESUMED',p_conversation::text);
 RETURN jsonb_build_object('conversationId',p_conversation,'mode','BOT','changed',true,'reviewOnly',true,'providerDelivery','NEVER_SUBMITTED');
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.resume_ai_assistance(text,uuid,boolean) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.resume_ai_assistance(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.resume_ai_assistance(text,uuid,boolean) TO musitu_runtime;
COMMIT;
