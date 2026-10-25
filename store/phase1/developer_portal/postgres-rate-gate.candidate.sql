-- MUSITU Store V2 PRIVATE candidate; NEVER run against the live Neon stage by
-- automation or without independently authorized production DBA/security review.
-- Execute only AFTER both review-journal.candidate.sql and
-- postgres-session-status.candidate.sql in an isolated disposable PostgreSQL 16.
-- Counters are mutable by design; all identities and revocations remain immutable.
BEGIN;
CREATE TABLE store_publisher_private.portal_rate_windows (
 scope_digest TEXT NOT NULL CHECK (scope_digest ~ '^[a-f0-9]{64}$'),
 route TEXT NOT NULL CHECK (route IN ('submit','upload','read','review')),
 minute_bucket BIGINT NOT NULL CHECK (minute_bucket > 0),
 used INTEGER NOT NULL CHECK (used BETWEEN 1 AND 100000),
 PRIMARY KEY (scope_digest,route,minute_bucket)
);
CREATE INDEX portal_rate_window_expiry_idx
 ON store_publisher_private.portal_rate_windows(minute_bucket);
-- Immutable session and enrollment checks MUST happen inside this stored DB
-- boundary, not merely from a caller's signature-valid JWT cache.
-- SECURITY DEFINER is intentionally fixed-search-path, no dynamic SQL, and
-- executable only by an explicitly provisioned narrow trusted service role.
-- No application/server role is granted privileges by this migration.
CREATE FUNCTION store_publisher_private.claim_portal_rate_permit(
 p_token_id TEXT,p_issuer TEXT,p_subject TEXT,p_role TEXT,
 p_publisher TEXT,p_audience TEXT,p_expires_unix BIGINT,p_route TEXT,
 p_actor_digest TEXT,p_publisher_digest TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,store_publisher_private AS $rate$
DECLARE
 v_actor_digest TEXT;v_publisher_digest TEXT;v_minute BIGINT;
 v_actor_limit INTEGER;v_publisher_limit INTEGER;v_reserved INTEGER;
BEGIN
 IF p_route NOT IN ('submit','upload','read','review') OR p_route IS NULL THEN RETURN FALSE; END IF;
 IF (p_role='developer' AND p_route='review') OR
    (p_role<>'developer' AND p_route IN ('submit','upload')) THEN RETURN FALSE; END IF;
 IF p_actor_digest IS NULL OR p_actor_digest !~ '^[a-f0-9]{64}$' THEN RETURN FALSE; END IF;
 IF p_role='developer' AND (p_publisher_digest IS NULL OR
   p_publisher_digest !~ '^[a-f0-9]{64}$') THEN RETURN FALSE; END IF;
 IF p_role<>'developer' AND p_publisher_digest IS NOT NULL THEN RETURN FALSE; END IF;
 -- Reject revoked, expired, cross-issuer, cross-role, cross-publisher and
 -- suspended identities at the same database boundary as quota acquisition.
 IF NOT EXISTS (
  SELECT 1 FROM store_publisher_private.portal_sessions s
  JOIN store_publisher_private.principal_enrollments p ON p.subject_id=s.subject_id
    AND p.role=s.role AND p.publisher_id IS NOT DISTINCT FROM s.publisher_id
  WHERE s.token_id=p_token_id AND s.subject_id=p_subject AND s.role=p_role
    AND s.publisher_id IS NOT DISTINCT FROM p_publisher
    AND s.issuer_uri=p_issuer AND s.audience=p_audience
    AND s.expires_unix=p_expires_unix
    AND s.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM store_publisher_private.session_revocations v
      WHERE v.token_id=s.token_id)
    AND NOT EXISTS(SELECT 1 FROM store_publisher_private.principal_suspensions v
      WHERE v.subject_id=s.subject_id)
 ) THEN RETURN FALSE; END IF;
 -- Recompute scope digests in PostgreSQL; even a compromised web-process
 -- caller must not select an arbitrary 'fresh' bucket to bypass limits.
 v_actor_digest=encode(sha256(convert_to('actor','UTF8')||decode('00','hex')||
   convert_to(p_issuer,'UTF8')||decode('00','hex')||
   convert_to(p_subject,'UTF8')||decode('00','hex')||convert_to(p_role,'UTF8')),'hex');
 IF v_actor_digest<>p_actor_digest THEN RETURN FALSE; END IF;
 IF p_role='developer' THEN
  v_publisher_digest=encode(sha256(convert_to('publisher','UTF8')||decode('00','hex')||
   convert_to(p_issuer,'UTF8')||decode('00','hex')||convert_to(p_publisher,'UTF8')),'hex');
  IF v_publisher_digest<>p_publisher_digest THEN RETURN FALSE; END IF;
 END IF;
 CASE p_route
 WHEN 'submit' THEN v_actor_limit:=8;v_publisher_limit:=12;
 WHEN 'upload' THEN v_actor_limit:=2;v_publisher_limit:=4;
 WHEN 'read' THEN v_actor_limit:=60;v_publisher_limit:=120;
 WHEN 'review' THEN v_actor_limit:=20;v_publisher_limit:=NULL;
 END CASE;
 v_minute=floor(EXTRACT(EPOCH FROM clock_timestamp()) / 60)::BIGINT;
 -- A caught quota exception rolls back BOTH reservations in this subtransaction.
 -- Thus an exhausted publisher does not waste a person's remaining actor quota.
 BEGIN
  INSERT INTO store_publisher_private.portal_rate_windows AS r
   (scope_digest,route,minute_bucket,used)
   VALUES (v_actor_digest,p_route,v_minute,1)
  ON CONFLICT (scope_digest,route,minute_bucket)
   DO UPDATE SET used=r.used+1 WHERE r.used<v_actor_limit
   RETURNING used INTO v_reserved;
  IF v_reserved IS NULL THEN RAISE EXCEPTION 'private actor rate limit reached' USING ERRCODE='P0429'; END IF;
  IF v_publisher_limit IS NOT NULL THEN
   v_reserved:=NULL;
   INSERT INTO store_publisher_private.portal_rate_windows AS r
    (scope_digest,route,minute_bucket,used)
    VALUES (v_publisher_digest,p_route,v_minute,1)
   ON CONFLICT (scope_digest,route,minute_bucket)
    DO UPDATE SET used=r.used+1 WHERE r.used<v_publisher_limit
    RETURNING used INTO v_reserved;
   IF v_reserved IS NULL THEN RAISE EXCEPTION 'private publisher rate limit reached' USING ERRCODE='P0429'; END IF;
  END IF;
 EXCEPTION WHEN SQLSTATE 'P0429' THEN RETURN FALSE;
 END;
 RETURN TRUE;
END $rate$;
REVOKE ALL ON store_publisher_private.portal_rate_windows FROM PUBLIC;
REVOKE ALL ON FUNCTION store_publisher_private.claim_portal_rate_permit(
 TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
COMMIT;
