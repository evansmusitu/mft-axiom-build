-- Offline PostgreSQL 17 acceptance for isolated Neon Store staging.
-- Requires a NEW disposable local CI PostgreSQL database, never the Neon account.
BEGIN;
INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status)
 VALUES('MUSITU_OWNED_APP',425,'USD','first_party','approved');
INSERT INTO store_customer_tokens(token_hash,customer_id,status,expires_at)
 VALUES(repeat('a',64),'customer_ci','active','2099-01-01T00:00:00.000Z');
INSERT INTO store_checkout_intents
 (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at)
 VALUES
 ('STORE-ABCDEF0123456789','customer_ci','MUSITU_OWNED_APP',425,'USD',
  'initiating','2026-10-21T00:00:00.000Z','2099-01-01T00:00:00.000Z'),
 ('STORE-ABCDEF0123456790','customer_ci','MUSITU_OWNED_APP',425,'USD',
  'initiating','2026-10-21T00:00:00.000Z','2099-01-01T00:00:00.000Z');

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_checkout_intents
   (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,
    browser_url,poll_url)
   VALUES('STORE-ABCDEF0123456791','customer_ci','MUSITU_OWNED_APP',425,'USD',
    'pending','2026-10-21T00:00:00.000Z','2099-01-01T00:00:00.000Z',
    'https://www.paynow.co.zw/Payment/123',
    'https://www.paynow.co.zw/Interface/CheckPayment/?guid=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'direct pending insert not blocked'; END IF;
END $$;

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_checkout_intents SET amount_cents=1
    WHERE reference='STORE-ABCDEF0123456789';
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'initiating order price rewrite not blocked'; END IF;
END $$;

UPDATE store_checkout_intents
 SET status='pending',
     browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/123',
     poll_url='https://www.paynow.co.zw/Interface/CheckPayment/?guid=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 WHERE reference='STORE-ABCDEF0123456789';

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_checkout_intents
   SET status='pending',
       browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/234',
       poll_url='https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
   WHERE reference='STORE-ABCDEF0123456790';
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'provider poll URL replay not blocked'; END IF;
END $$;

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_checkout_intents SET status='review_required'
   WHERE reference='STORE-ABCDEF0123456789';
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'review without provider evidence not blocked'; END IF;
END $$;

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  INSERT INTO store_checkout_reviews
   (reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at)
   VALUES('STORE-ABCDEF0123456790','PAYNOW-STAGING-CI2','review_required',
          repeat('c',64),repeat('d',64),'2026-10-21T00:00:00.000Z');
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'provider evidence on initiating order not blocked'; END IF;
END $$;

INSERT INTO store_checkout_reviews
 (reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at)
 VALUES('STORE-ABCDEF0123456789','PAYNOW-STAGING-CI1','review_required',
        repeat('c',64),repeat('d',64),'2026-10-21T00:00:00.000Z');
UPDATE store_checkout_intents SET status='review_required'
 WHERE reference='STORE-ABCDEF0123456789';

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_checkout_intents SET status='pending'
   WHERE reference='STORE-ABCDEF0123456789';
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'reviewed order reopened'; END IF;
END $$;

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  DELETE FROM store_checkout_reviews WHERE reference='STORE-ABCDEF0123456789';
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'signed evidence deletion not blocked'; END IF;
END $$;

UPDATE store_customer_tokens SET status='revoked' WHERE token_hash=repeat('a',64);
DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  UPDATE store_customer_tokens SET status='active' WHERE token_hash=repeat('a',64);
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked token resurrected'; END IF;
END $$;

DO $$
DECLARE denied BOOLEAN:=FALSE;
BEGIN
 BEGIN
  DELETE FROM store_customer_tokens WHERE token_hash=repeat('a',64);
 EXCEPTION WHEN OTHERS THEN denied:=TRUE;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked token tombstone deletion allowed'; END IF;
END $$;

DO $$
BEGIN
 IF (SELECT count(*) FROM store_checkout_intents)!=2
    OR (SELECT count(*) FROM store_checkout_reviews)!=1
    OR (SELECT status FROM store_checkout_intents
        WHERE reference='STORE-ABCDEF0123456789')!='review_required'
    OR (SELECT status FROM store_checkout_intents
        WHERE reference='STORE-ABCDEF0123456790')!='initiating'
    OR EXISTS(SELECT 1 FROM store_checkout_reviews
              WHERE review_status NOT IN ('review_required','refund_review_required')) THEN
  RAISE EXCEPTION 'Store Neon state and review qualification mismatch';
 END IF;
END $$;
ROLLBACK;
SELECT 'MUSITU_STORE_NEON_POSTGRES_ISOLATED_SCHEMA_PASS' AS verification;
