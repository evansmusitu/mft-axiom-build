-- DISPOSABLE PostgreSQL 16 regression only. All fixtures roll back.
-- Execute after all Store V2 journal, session, and rate candidate SQL files.
BEGIN;
DO $retention_test$
DECLARE
 current_minute BIGINT;
 n INTEGER;
 old_count INTEGER;
 recent_count INTEGER;
 publicly_executable BOOLEAN;
 invalid_blocked BOOLEAN;
BEGIN
 current_minute=floor(EXTRACT(EPOCH FROM clock_timestamp()) / 60)::BIGINT;
 INSERT INTO store_publisher_private.portal_rate_windows(scope_digest,route,minute_bucket,used)
 VALUES
  (repeat('a',64),'upload',current_minute-9,1),
  (repeat('b',64),'upload',current_minute-8,1),
  (repeat('c',64),'upload',current_minute-7,1),
  (repeat('d',64),'upload',current_minute-1,2),
  (repeat('e',64),'upload',current_minute,3);
 SELECT store_publisher_private.prune_portal_rate_windows(2) INTO n;
 IF n<>2 THEN RAISE EXCEPTION 'batch limit violated: %',n; END IF;
 SELECT count(*) INTO old_count FROM store_publisher_private.portal_rate_windows
  WHERE minute_bucket<current_minute-2;
 IF old_count<>1 THEN RAISE EXCEPTION 'first cleanup failed: %',old_count;END IF;
 SELECT store_publisher_private.prune_portal_rate_windows(1000) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'remaining expired cleanup failed: %',n;END IF;
 SELECT store_publisher_private.prune_portal_rate_windows(1000) INTO n;
 IF n<>0 THEN RAISE EXCEPTION 'idempotent cleanup failed: %',n;END IF;
 SELECT count(*) INTO recent_count FROM store_publisher_private.portal_rate_windows
  WHERE minute_bucket>=current_minute-1;
 IF recent_count<>2 THEN RAISE EXCEPTION 'active quota windows removed: %',recent_count;END IF;
 FOREACH n IN ARRAY ARRAY[0,-1,1001] LOOP
  invalid_blocked:=FALSE;
  BEGIN
   PERFORM store_publisher_private.prune_portal_rate_windows(n);
  EXCEPTION WHEN SQLSTATE '22023' THEN invalid_blocked:=TRUE;
  END;
  IF NOT invalid_blocked THEN RAISE EXCEPTION 'unsafe retention batch permitted: %',n;END IF;
 END LOOP;
 invalid_blocked:=FALSE;
 BEGIN
  PERFORM store_publisher_private.prune_portal_rate_windows(NULL);
 EXCEPTION WHEN SQLSTATE '22023' THEN invalid_blocked:=TRUE;
 END;
 IF NOT invalid_blocked THEN RAISE EXCEPTION 'unbounded NULL retention permitted';END IF;
 SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS p,
   LATERAL pg_catalog.aclexplode(
     COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid='store_publisher_private.prune_portal_rate_windows(integer)'::regprocedure
   AND a.grantee=0 AND a.privilege_type='EXECUTE'
 ) INTO publicly_executable;
 IF publicly_executable THEN RAISE EXCEPTION 'public quota maintenance execute privilege';END IF;
 IF (SELECT count(*) FROM store_publisher_private.portal_rate_windows)<>2 THEN
   RAISE EXCEPTION 'retention mutated protected live buckets';
 END IF;
END $retention_test$;
ROLLBACK;
