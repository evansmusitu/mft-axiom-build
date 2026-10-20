import pathlib
import sqlite3
import unittest

SCHEMA = pathlib.Path(__file__).with_name("store-axiom-checkout-schema.sql")

class StorePaymentSqlPolicyTests(unittest.TestCase):
    def test_review_requires_prior_verified_provider_record(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE store_checkout_intents SET status='review_required'")
        self.assertEqual(self.db.execute("SELECT status FROM store_checkout_intents").fetchone()[0],
                         "pending")

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA.read_text())
        self.db.execute("INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status) VALUES('MUSITU_OWNED_APP',425,'USD','first_party','approved')")
        self.db.execute("""INSERT INTO store_checkout_intents
          (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,browser_url,poll_url)
          VALUES('STORE-ABCDEF0123456789','customer_fixture','MUSITU_OWNED_APP',425,'USD',
          'initiating','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z',
          NULL,NULL)""")
        self.db.execute("""UPDATE store_checkout_intents
          SET status='pending', browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/1234',
          poll_url='https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'
          WHERE reference='STORE-ABCDEF0123456789'""")

    def provider_review(self, status="review_required"):
        self.db.execute("""INSERT INTO store_checkout_reviews
          (reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at)
          VALUES('STORE-ABCDEF0123456789','PAYNOW-TEST-ONE',?,?,?,'2026-10-19T00:00:00Z')""",
          (status,"a"*64,"b"*64))

    def test_matching_provider_review_promotes_pending_order(self):
        self.provider_review()
        self.db.execute("UPDATE store_checkout_intents SET status='review_required'")
        self.assertEqual(self.db.execute("SELECT status FROM store_checkout_intents").fetchone()[0],
                         "review_required")

    def test_review_cannot_reopen_a_paid_order_as_pending(self):
        self.provider_review()
        self.db.execute("UPDATE store_checkout_intents SET status='review_required'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE store_checkout_intents SET status='pending'")

    def test_cancelled_order_does_not_accept_provider_review(self):
        self.db.execute("UPDATE store_checkout_intents SET status='cancelled'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.provider_review()

    def test_signed_provider_review_cannot_be_rewritten_or_deleted(self):
        self.provider_review()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE store_checkout_reviews SET review_status='refund_review_required'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM store_checkout_reviews")

    def test_replace_cannot_change_immutable_signed_review_evidence_before_order_transition(self):
        # With PRAGMA recursive_triggers=OFF (SQLite default), REPLACE's
        # implicit conflicting-row DELETE may bypass the DELETE trigger.
        self.provider_review()
        before = self.db.execute(
            "SELECT paynow_reference,review_status,callback_digest,poll_digest "
            "FROM store_checkout_reviews").fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT OR REPLACE INTO store_checkout_reviews
                (reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at)
                VALUES('STORE-ABCDEF0123456789','PAYNOW-TEST-ATTACK',
                'refund_review_required',?,?, '2026-10-19T00:01:00Z')""",
                ("c"*64,"d"*64))
        self.assertEqual(self.db.execute(
            "SELECT paynow_reference,review_status,callback_digest,poll_digest "
            "FROM store_checkout_reviews").fetchone(),before)

    def test_replace_cannot_reassign_provider_transaction_to_another_pending_order(self):
        self.provider_review()
        self.db.execute("""INSERT INTO store_checkout_intents
          (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,browser_url,poll_url)
          VALUES('STORE-ABCDEF0123456790','customer_fixture','MUSITU_OWNED_APP',425,'USD',
          'initiating','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z',
          NULL,NULL)""")
        self.db.execute("""UPDATE store_checkout_intents
          SET status='pending', browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/1234',
          poll_url='https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'
          WHERE reference='STORE-ABCDEF0123456790'""")
        before = self.db.execute(
            "SELECT reference,paynow_reference FROM store_checkout_reviews").fetchall()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT OR REPLACE INTO store_checkout_reviews
              (reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at)
              VALUES('STORE-ABCDEF0123456790','PAYNOW-TEST-ONE','review_required',?,?,
              '2026-10-19T00:01:00Z')""",("c"*64,"d"*64))
        self.assertEqual(self.db.execute(
            "SELECT reference,paynow_reference FROM store_checkout_reviews").fetchall(),before)

    def test_direct_reviewed_order_insert_cannot_bypass_signed_evidence(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO store_checkout_intents
                (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at)
                VALUES('STORE-ABCDEF0123456790','customer_fixture','MUSITU_OWNED_APP',425,
                       'USD','review_required','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z')""")

    def test_replace_statement_cannot_resurrect_cancelled_checkout(self):
        self.db.execute("UPDATE store_checkout_intents SET status='cancelled'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT OR REPLACE INTO store_checkout_intents
                (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,
                 browser_url,poll_url)
                VALUES('STORE-ABCDEF0123456789','customer_fixture','MUSITU_OWNED_APP',
                       425,'USD','pending','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z',
                       'https://www.paynow.co.zw/Payment/ConfirmPayment/1234',
                       'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444')""")
        self.assertEqual(self.db.execute("SELECT status FROM store_checkout_intents").fetchone()[0],"cancelled")

    def test_direct_pending_insert_rejected_before_provider_initiation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO store_checkout_intents
              (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,browser_url,poll_url)
              VALUES('STORE-ABCDEF0123456799','customer_fixture','MUSITU_OWNED_APP',425,'USD',
              'pending','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z',
              'https://www.paynow.co.zw/Payment/ConfirmPayment/1234',
              'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444')""")

    def test_initiating_order_amount_customer_sku_and_expiry_cannot_change(self):
        self.db.execute("""INSERT INTO store_checkout_intents
          (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at)
          VALUES('STORE-ABCDEF0123456799','customer_fixture','MUSITU_OWNED_APP',425,'USD',
          'initiating','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z')""")
        for patch in ("amount_cents=1", "customer_id='other_customer'",
                      "sku='DIFFERENT_APP'", "expires_at='2099-02-01T00:00:00Z'"):
            with self.subTest(patch=patch), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE store_checkout_intents SET " + patch +
                                " WHERE reference='STORE-ABCDEF0123456799'")
        self.assertEqual(
            self.db.execute("SELECT amount_cents,customer_id,status FROM store_checkout_intents "
                            "WHERE reference='STORE-ABCDEF0123456799'").fetchone(),
            (425, 'customer_fixture', 'initiating'),
        )

    def test_provider_urls_cannot_be_attached_during_initiating_or_preseeded(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO store_checkout_intents
              (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,poll_url)
              VALUES('STORE-ABCDEF0123456799','customer_fixture','MUSITU_OWNED_APP',425,'USD',
              'initiating','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z','fake')""")
        self.db.execute("""INSERT INTO store_checkout_intents
          (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at)
          VALUES('STORE-ABCDEF0123456799','customer_fixture','MUSITU_OWNED_APP',425,'USD',
          'initiating','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE store_checkout_intents SET poll_url='fake' "
                            "WHERE reference='STORE-ABCDEF0123456799'")

    def test_pending_provider_poll_url_cannot_be_replaced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE store_checkout_intents SET poll_url='https://not-provider.invalid/status'")

if __name__ == "__main__":
    unittest.main()
