import pathlib
import sqlite3
import unittest

SCHEMA = pathlib.Path(__file__).with_name("store-axiom-checkout-schema.sql")

class StorePaymentSqlPolicyTests(unittest.TestCase):
    def test_review_requires_prior_verified_provider_record(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(SCHEMA.read_text())
        db.execute("INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status) VALUES('MUSITU_OWNED_APP',425,'USD','first_party','approved')")
        db.execute("""INSERT INTO store_checkout_intents
            (reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at,browser_url,poll_url)
            VALUES('STORE-ABCDEF0123456789','customer_fixture','MUSITU_OWNED_APP',425,'USD',
            'pending','2026-10-19T00:00:00Z','2099-01-01T00:00:00Z',
            'https://www.paynow.co.zw/Payment/ConfirmPayment/1234',
            'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444')""")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE store_checkout_intents SET status='review_required'")
        self.assertEqual(db.execute("SELECT status FROM store_checkout_intents").fetchone()[0],"pending")

if __name__ == "__main__":
    unittest.main()
