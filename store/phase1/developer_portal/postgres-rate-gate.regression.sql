-- Real DISPOSABLE PostgreSQL 16 only; no external producer, identity or money.
-- Execute after review-journal, session-registry, then rate-gate candidate SQL.
-- A single transaction rolls back all synthetic accounts and counter rows.
BEGIN;
INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id)
 VALUES ('quota-developer-0001','developer','quota-test-publisher'),
        ('quota-developer-0002','developer','quota-test-publisher'),
        ('quota-reviewer-0001','review_security',NULL);
INSERT INTO store_publisher_private.portal_sessions
 (token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix)
 VALUES ('quota-dev-token-000001','quota-developer-0001','developer','quota-test-publisher',
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800),
  ('quota-dev-token-rotated1','quota-developer-0001','developer','quota-test-publisher',
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800),
  ('quota-dev-token-000002','quota-developer-0002','developer','quota-test-publisher',
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800),
  ('quota-reviewer-token01','quota-reviewer-0001','review_security',NULL,
   'https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+1800);
DO $test$
DECLARE
 v_a1 TEXT;v_a2 TEXT;v_t TEXT;v_r TEXT;v_ok BOOL;v_exp BIGINT;v_exp2 BIGINT;v_count INTEGER;
BEGIN
 v_a1=encode(sha256(convert_to('actor','UTF8')||decode('00','hex')||
   convert_to('https://issuer.example.org','UTF8')||decode('00','hex')||
   convert_to('quota-developer-0001','UTF8')||decode('00','hex')||convert_to('developer','UTF8')),'hex');
 v_a2=encode(sha256(convert_to('actor','UTF8')||decode('00','hex')||
   convert_to('https://issuer.example.org','UTF8')||decode('00','hex')||
   convert_to('quota-developer-0002','UTF8')||decode('00','hex')||convert_to('developer','UTF8')),'hex');
 v_t=encode(sha256(convert_to('publisher','UTF8')||decode('00','hex')||
   convert_to('https://issuer.example.org','UTF8')||decode('00','hex')||convert_to('quota-test-publisher','UTF8')),'hex');
 v_r=encode(sha256(convert_to('actor','UTF8')||decode('00','hex')||
   convert_to('https://issuer.example.org','UTF8')||decode('00','hex')||
   convert_to('quota-reviewer-0001','UTF8')||decode('00','hex')||convert_to('review_security','UTF8')),'hex');
 SELECT expires_unix INTO v_exp FROM store_publisher_private.portal_sessions WHERE token_id='quota-dev-token-000001';
 SELECT expires_unix INTO v_exp2 FROM store_publisher_private.portal_sessions WHERE token_id='quota-dev-token-000002';
 FOR i IN 1..8 LOOP
  SELECT store_publisher_private.claim_portal_rate_permit(
   CASE WHEN i=8 THEN 'quota-dev-token-rotated1' ELSE 'quota-dev-token-000001' END,
   'https://issuer.example.org','quota-developer-0001','developer','quota-test-publisher',
   'store-v2-internal',v_exp,'submit',v_a1,v_t) INTO v_ok;
  IF v_ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'valid actor permit denied at attempt %',i;END IF;
 END LOOP;
 SELECT store_publisher_private.claim_portal_rate_permit('quota-dev-token-rotated1',
  'https://issuer.example.org','quota-developer-0001','developer','quota-test-publisher',
  'store-v2-internal',v_exp,'submit',v_a1,v_t) INTO v_ok;
 IF v_ok IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'JWT rotation bypassed actor ceiling';END IF;
 -- Second developer has a fresh ACTOR but the SAME protected publisher.
 FOR i IN 1..4 LOOP
  SELECT store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
   'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
   'store-v2-internal',v_exp2,'submit',v_a2,v_t) INTO v_ok;
  IF v_ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'publisher capacity below twelve';END IF;
 END LOOP;
 SELECT store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
   'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
   'store-v2-internal',v_exp2,'submit',v_a2,v_t) INTO v_ok;
 IF v_ok IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'publisher-wide cap bypassed';END IF;
 SELECT used INTO v_count FROM store_publisher_private.portal_rate_windows
  WHERE scope_digest=v_a2 AND route='submit';
 IF v_count<>4 THEN RAISE EXCEPTION 'publisher rejection still consumed actor permit';END IF;
 -- Incorrect issuer, audience, principal, role, expiration, publisher or digest.
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://evil.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',v_exp2,'upload',v_a2,v_t) THEN RAISE EXCEPTION 'issuer confusion accepted';END IF;
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'other-audience',v_exp2,'upload',v_a2,v_t) THEN RAISE EXCEPTION 'audience confusion accepted';END IF;
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','other-publisher',
  'store-v2-internal',v_exp2,'upload',v_a2,v_t) THEN RAISE EXCEPTION 'cross-publisher accepted';END IF;
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',v_exp2,'upload',repeat('a',64),v_t) THEN RAISE EXCEPTION 'attacker-supplied hash bypass accepted';END IF;
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',v_exp2+1,'upload',v_a2,v_t) THEN RAISE EXCEPTION 'expired or mismatched identity accepted';END IF;
 IF store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',v_exp2,'review',v_a2,v_t) THEN RAISE EXCEPTION 'developer reviewer route accepted';END IF;
 -- Reviewer has a different approved enrollment but no publisher scope.
 SELECT expires_unix INTO v_exp FROM store_publisher_private.portal_sessions WHERE token_id='quota-reviewer-token01';
 IF NOT store_publisher_private.claim_portal_rate_permit('quota-reviewer-token01',
  'https://issuer.example.org','quota-reviewer-0001','review_security',NULL,
  'store-v2-internal',v_exp,'review',v_r,NULL) THEN RAISE EXCEPTION 'independent reviewer capacity denied';END IF;
 -- Separate action limits must be independent of exhausted submit budget.
 IF NOT store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',v_exp2,'upload',v_a2,v_t) THEN RAISE EXCEPTION 'upload budget incorrectly shared with submit';END IF;
END $test$;
-- Single-use revocation is permanent: reissued signed claims cannot restore it.
INSERT INTO store_publisher_private.session_revocations(token_id,reason_digest)
 VALUES('quota-dev-token-000002',repeat('a',64));
DO $test$
DECLARE x BIGINT;d1 TEXT;d2 TEXT;approved BOOL;
BEGIN
 SELECT expires_unix INTO x FROM store_publisher_private.portal_sessions WHERE token_id='quota-dev-token-000002';
 d1=encode(sha256(convert_to('actor','UTF8')||decode('00','hex')||convert_to('https://issuer.example.org','UTF8')||
   decode('00','hex')||convert_to('quota-developer-0002','UTF8')||decode('00','hex')||convert_to('developer','UTF8')),'hex');
 d2=encode(sha256(convert_to('publisher','UTF8')||decode('00','hex')||convert_to('https://issuer.example.org','UTF8')||
   decode('00','hex')||convert_to('quota-test-publisher','UTF8')),'hex');
 approved=store_publisher_private.claim_portal_rate_permit('quota-dev-token-000002',
  'https://issuer.example.org','quota-developer-0002','developer','quota-test-publisher',
  'store-v2-internal',x,'upload',d1,d2);
 IF approved IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'revoked session retained permit';END IF;
END $test$;
ROLLBACK;
