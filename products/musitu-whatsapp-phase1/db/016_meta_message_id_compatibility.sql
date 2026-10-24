-- Function-only compatibility correction. No tables, grants or row updates.
-- Never repairs, resets or completes an existing UNKNOWN attempt.
BEGIN;
CREATE OR REPLACE FUNCTION musitu.complete_development_reply(p_actor text,p_attempt uuid,p_status text,p_provider text,p_http integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; prior musitu.outbound_attempts;
BEGIN
 -- MUSITU_META_MESSAGE_ID_COMPATIBILITY_V16
 IF scope IS DISTINCT FROM '986eb904-7296-46a9-9e9b-94074db9b547'::uuid OR p_actor IS DISTINCT FROM '395558180472062118' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO prior FROM musitu.outbound_attempts WHERE tenant_id=scope AND attempt_id=p_attempt AND dev_review_actor=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_status IS NULL OR p_status NOT IN('UNKNOWN','ACCEPTED','FAILED') OR (p_http IS NOT NULL AND p_http NOT BETWEEN 100 AND 599) THEN RAISE EXCEPTION 'INVALID_DEVELOPMENT_OUTCOME'; END IF;
 IF (p_status='ACCEPTED' AND (p_http IS DISTINCT FROM 200 OR p_provider IS NULL OR length(p_provider)>186 OR p_provider !~ '^wamid\.[A-Za-z0-9._~+/-]{1,180}={0,2}$')) OR (p_status<>'ACCEPTED' AND p_provider IS NOT NULL) OR (p_status='FAILED' AND (p_http IS NULL OR p_http NOT BETWEEN 400 AND 499 OR p_http IN(408,429))) THEN RAISE EXCEPTION 'INVALID_DEVELOPMENT_OUTCOME'; END IF;
 IF prior.dev_outcome_recorded_at IS NOT NULL THEN RETURN jsonb_build_object('status',prior.status,'idempotent',true); END IF;
 IF prior.status<>'UNKNOWN' OR prior.provider_message_id IS NOT NULL THEN RAISE EXCEPTION 'DEVELOPMENT_OUTCOME_CONFLICT'; END IF;
 UPDATE musitu.outbound_attempts SET status=p_status,provider_message_id=p_provider,dev_http_status=p_http,dev_outcome_recorded_at=clock_timestamp() WHERE tenant_id=scope AND attempt_id=p_attempt;
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id) VALUES(scope,p_actor,'DEVELOPMENT_REPLY_OUTCOME_RECORDED',p_attempt::text);
 RETURN jsonb_build_object('status',p_status,'idempotent',false);
END $$;
COMMIT;
