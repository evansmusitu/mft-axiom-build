-- OPERATOR ONLY. Do not execute without explicit renewed consent from Evans Musitu.
-- No provider send. No credential, membership, schema, grant or public-release change.
-- Before execution in this SAME transaction, set the two app.operator_* settings
-- from the newly approved external instruction. Never invent a consent reference.
-- This file deliberately has no BEGIN/COMMIT: the caller owns atomic execution.
SET LOCAL statement_timeout='8s';
SELECT set_config('app.tenant_id','986eb904-7296-46a9-9e9b-94074db9b547',true);
-- Serialize against inbound/STOP persistence during the state check and removal.
-- A STOP arriving afterward can insert a fresh suppression normally.
LOCK TABLE musitu.inbound_events IN SHARE MODE;
LOCK TABLE musitu.customer_suppressions IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
 scope uuid:='986eb904-7296-46a9-9e9b-94074db9b547';
 convo uuid:='be5bc20e-7923-46be-a72f-39876eba48fe';
 previous musitu.customer_suppressions;
 proof text:=current_setting('app.operator_renewed_consent_ref',true);
BEGIN
 IF current_database()<>'musitu_whatsapp_phase1' OR current_user<>'musitu_whatsapp_phase1_owner'
 OR current_setting('app.operator_test_reconsent',true) IS DISTINCT FROM 'EXPLICIT_OWNER_CONSENT_CONFIRMED'
 OR proof IS NULL OR length(trim(proof)) NOT BETWEEN 1 AND 300 THEN
  RAISE EXCEPTION 'EXPLICIT_OWNER_RECONSENT_REQUIRED';
 END IF;
 PERFORM 1 FROM musitu.tenants WHERE id=scope AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_TENANT_REJECTED'; END IF;
 PERFORM 1 FROM musitu.memberships WHERE tenant_id=scope AND actor_id='395558180472062118' AND role='OWNER' AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_OWNER_REJECTED'; END IF;
 PERFORM 1 FROM musitu.conversations c JOIN musitu.whatsapp_channels w
 ON w.tenant_id=c.tenant_id AND w.phone_number_id=c.phone_number_id
 WHERE c.tenant_id=scope AND c.conversation_id=convo AND c.handling_mode='HUMAN'
 AND w.phone_number_id='1292923853915392' AND w.waba_id='1955690452095441' AND w.status='VERIFIED' FOR SHARE OF c,w;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_CHANNEL_REJECTED'; END IF;
 -- Do not erase a changed opt-out, newly arrived STOP or a provider-origin opt-out.
 IF (SELECT count(*) FROM musitu.inbound_events WHERE tenant_id=scope)<>2
 OR (SELECT max(received_at) FROM musitu.inbound_events WHERE tenant_id=scope)
 IS DISTINCT FROM '2026-10-20T10:05:07.712Z'::timestamptz
 OR EXISTS(SELECT 1 FROM musitu.outbound_attempts WHERE tenant_id=scope) THEN
  RAISE EXCEPTION 'TEST_STATE_CHANGED_REDIAGNOSE';
 END IF;
 SELECT * INTO previous FROM musitu.customer_suppressions
 WHERE tenant_id=scope AND conversation_id=convo FOR UPDATE;
 IF NOT FOUND OR previous.source_kind<>'STAFF_ATTESTATION'
 OR previous.staff_actor_id IS NULL
 OR previous.recorded_at IS DISTINCT FROM '2026-10-20T10:12:18.793Z'::timestamptz THEN
  RAISE EXCEPTION 'SUPPRESSION_CHANGED_REDIAGNOSE';
 END IF;
 -- Keep the exact previous record and external consent reference for audit/recovery.
 -- This is operator-recorded renewed consent, not a fabricated SaaS button click.
 INSERT INTO musitu.action_audit(tenant_id,actor_id,action,reference_id)
 VALUES(scope,'395558180472062118','OWNER_TEST_RECONSENT_OPERATOR_RECORDED',
 jsonb_build_object('conversationId',convo,'consentEvidenceRef',proof,
 'previousSuppression',to_jsonb(previous),'sendPerformed',false)::text);
 DELETE FROM musitu.customer_suppressions WHERE tenant_id=scope AND conversation_id=convo;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPRESSION_REMOVE_CONFLICT'; END IF;
END $$;
-- Caller verifies the exact audit row and only one suppression removed before COMMIT.
-- The owner must still review/consent/submit through the authenticated SaaS sender.
