-- Adversarial real disposable PostgreSQL 16 qualification.
-- Rolls back all fixture states, leaving no fake authorizations.
BEGIN;
DO $$
DECLARE digest TEXT := repeat('a',64); item BYTEA := decode(repeat('ab',80),'hex');
        first_count INTEGER; second_count INTEGER; consumed BYTEA;
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants
  WHERE grantee='PUBLIC' AND table_schema='store_publisher_private' AND table_name='oidc_flows') THEN
  RAISE EXCEPTION 'private OIDC state publicly granted';
 END IF;
 INSERT INTO store_publisher_private.oidc_flows (state_digest,encrypted_record,expires_at)
 VALUES (digest,item,clock_timestamp()+INTERVAL '5 minutes')
 ON CONFLICT (state_digest) DO NOTHING;
 GET DIAGNOSTICS first_count=ROW_COUNT;
 INSERT INTO store_publisher_private.oidc_flows (state_digest,encrypted_record,expires_at)
 VALUES (digest,decode(repeat('ac',80),'hex'),clock_timestamp()+INTERVAL '5 minutes')
 ON CONFLICT (state_digest) DO NOTHING;
 GET DIAGNOSTICS second_count=ROW_COUNT;
 IF first_count<>1 OR second_count<>0 THEN RAISE EXCEPTION 'duplicate flow replaced'; END IF;
 DELETE FROM store_publisher_private.oidc_flows WHERE state_digest=digest
 AND expires_at>clock_timestamp() RETURNING encrypted_record INTO consumed;
 IF consumed IS DISTINCT FROM item THEN RAISE EXCEPTION 'state consume corrupted'; END IF;
 consumed=NULL;
 DELETE FROM store_publisher_private.oidc_flows WHERE state_digest=digest
 AND expires_at>clock_timestamp() RETURNING encrypted_record INTO consumed;
 IF consumed IS NOT NULL THEN RAISE EXCEPTION 'OIDC callback replay'; END IF;
 INSERT INTO store_publisher_private.oidc_flows (state_digest,encrypted_record,expires_at)
 VALUES (repeat('b',64),item,clock_timestamp()+INTERVAL '2 seconds');
 PERFORM pg_sleep(3);
 DELETE FROM store_publisher_private.oidc_flows WHERE state_digest=repeat('b',64)
 AND expires_at>clock_timestamp() RETURNING encrypted_record INTO consumed;
 IF consumed IS NOT NULL THEN RAISE EXCEPTION 'expired callback permitted'; END IF;
 IF EXISTS(SELECT 1 FROM store_publisher_private.oidc_flows WHERE state_digest=digest) THEN
  RAISE EXCEPTION 'consumed flow persisted';
 END IF;
END $$;
ROLLBACK;
DO $ BEGIN
 IF (SELECT count(*) FROM store_publisher_private.oidc_flows) <> 0 THEN
  RAISE EXCEPTION 'disposable OIDC fixtures not rolled back';
 END IF;
END $;
SELECT 'MUSITU_PRIVATE_OIDC_FLOW_PG16_PASS' AS oidc_flow_qualification;
