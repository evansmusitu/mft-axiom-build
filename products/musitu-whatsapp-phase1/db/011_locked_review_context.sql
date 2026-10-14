BEGIN;
GRANT SELECT ON musitu.reply_drafts,musitu.faqs,musitu.draft_approvals,musitu.whatsapp_channels,
 musitu.inbound_events,musitu.customer_suppressions,musitu.channel_consent_evidence TO musitu_commands;
-- PostgreSQL row locks require UPDATE privilege. Only the non-login function
-- identity receives narrow column grants; runtime still has no direct UPDATE.
GRANT UPDATE(status) ON musitu.reply_drafts TO musitu_commands;
GRANT UPDATE(answer) ON musitu.faqs TO musitu_commands;
GRANT UPDATE(source_digest) ON musitu.draft_approvals TO musitu_commands;
GRANT UPDATE(status) ON musitu.whatsapp_channels,musitu.channel_consent_evidence TO musitu_commands;
CREATE FUNCTION musitu.draft_review_context(p_actor text,p_draft uuid)
 RETURNS TABLE(draft_id uuid,conversation_id uuid,source_faq_id uuid,body text,normalized_question text,
 draft_status text,source_answer text,source_question text,handling_mode text,customer_suppressed boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','AGENT') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM musitu.memberships m WHERE m.tenant_id=scope AND m.actor_id=p_actor FOR SHARE;
 RETURN QUERY SELECT d.draft_id,d.conversation_id,d.source_faq_id,d.body,d.normalized_question,d.status,
 f.answer,f.normalized_question,c.handling_mode,
 EXISTS(SELECT 1 FROM musitu.customer_suppressions s WHERE s.tenant_id=d.tenant_id AND s.conversation_id=d.conversation_id)
 FROM musitu.reply_drafts d JOIN musitu.faqs f ON f.tenant_id=d.tenant_id AND f.faq_id=d.source_faq_id
 JOIN musitu.conversations c ON c.tenant_id=d.tenant_id AND c.conversation_id=d.conversation_id
 WHERE d.tenant_id=scope AND d.draft_id=p_draft FOR SHARE OF d,f,c;
END $$;
CREATE FUNCTION musitu.staging_context(p_actor text,p_draft uuid)
 RETURNS TABLE(draft_id uuid,conversation_id uuid,source_faq_id uuid,body text,normalized_question text,
 draft_status text,source_answer text,source_question text,handling_mode text,phone_number_id text,remote_wa_id text,
 channel_status text,source_digest text,reviewer_active boolean,session_active boolean,customer_suppressed boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','AGENT') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM musitu.memberships m WHERE m.tenant_id=scope AND m.actor_id=p_actor FOR SHARE;
 RETURN QUERY SELECT d.draft_id,d.conversation_id,d.source_faq_id,d.body,d.normalized_question,d.status,
 f.answer,f.normalized_question,c.handling_mode,c.phone_number_id,c.remote_wa_id,wc.status,a.source_digest,
 EXISTS(SELECT 1 FROM musitu.memberships m WHERE m.tenant_id=a.tenant_id AND m.actor_id=a.actor_id AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','AGENT')),
 EXISTS(SELECT 1 FROM musitu.inbound_events e WHERE e.tenant_id=d.tenant_id AND e.conversation_id=d.conversation_id AND e.phone_number_id=c.phone_number_id AND e.provider_sent_at<=CURRENT_TIMESTAMP AND e.provider_sent_at>=CURRENT_TIMESTAMP-INTERVAL '23 hours 55 minutes'),
 EXISTS(SELECT 1 FROM musitu.customer_suppressions s WHERE s.tenant_id=d.tenant_id AND s.conversation_id=d.conversation_id)
 FROM musitu.reply_drafts d JOIN musitu.faqs f ON f.tenant_id=d.tenant_id AND f.faq_id=d.source_faq_id
 JOIN musitu.conversations c ON c.tenant_id=d.tenant_id AND c.conversation_id=d.conversation_id
 JOIN musitu.whatsapp_channels wc ON wc.tenant_id=c.tenant_id AND wc.phone_number_id=c.phone_number_id
 JOIN musitu.draft_approvals a ON a.tenant_id=d.tenant_id AND a.draft_id=d.draft_id
 WHERE d.tenant_id=scope AND d.draft_id=p_draft FOR SHARE OF d,f,c,a,wc;
END $$;
CREATE FUNCTION musitu.consent_context(p_actor text,p_phone text,p_recipient text)
 RETURNS TABLE(status text,scope text,evidence_ref text,valid boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE tenant uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=tenant AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','AGENT') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN QUERY SELECT c.status,c.scope,c.evidence_ref,(c.expires_at>CURRENT_TIMESTAMP AND c.confirmed_at<=CURRENT_TIMESTAMP)
 FROM musitu.channel_consent_evidence c WHERE c.tenant_id=tenant AND c.phone_number_id=p_phone AND c.recipient_hash=p_recipient FOR SHARE;
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.draft_review_context(text,uuid) OWNER TO musitu_commands;
ALTER FUNCTION musitu.staging_context(text,uuid) OWNER TO musitu_commands;
ALTER FUNCTION musitu.consent_context(text,text,text) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.draft_review_context(text,uuid),musitu.staging_context(text,uuid),musitu.consent_context(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.draft_review_context(text,uuid),musitu.staging_context(text,uuid),musitu.consent_context(text,text,text) TO musitu_runtime;
COMMIT;
BEGIN;
CREATE FUNCTION musitu.suppression_context(p_actor text,p_conversation uuid)
 RETURNS TABLE(phone_number_id text,remote_wa_id text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,musitu SET row_security=on AS $$
DECLARE scope uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=scope AND m.actor_id=p_actor AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','AGENT') AND t.status='ACTIVE') THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 RETURN QUERY SELECT c.phone_number_id,c.remote_wa_id FROM musitu.conversations c
 WHERE c.tenant_id=scope AND c.conversation_id=p_conversation FOR UPDATE;
END $$;
GRANT CREATE ON SCHEMA musitu TO musitu_commands;
ALTER FUNCTION musitu.suppression_context(text,uuid) OWNER TO musitu_commands;
REVOKE CREATE ON SCHEMA musitu FROM musitu_commands;
REVOKE ALL ON FUNCTION musitu.suppression_context(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musitu.suppression_context(text,uuid) TO musitu_runtime;
COMMIT;
