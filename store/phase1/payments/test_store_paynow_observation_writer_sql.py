"""Private real SQLite contract tests for the opt-in Store Paynow observation writer.

Synthetic data only. Never connect to Paynow, Neon, or deployed Store.
"""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
ROUTES = ROOT / 'store-axiom-payment-routes.mjs'
SCHEMA = ROOT / 'store-axiom-checkout-schema.sql'
OBS_SCHEMA = ROOT / 'store-paynow-status-observations.candidate.sql'
REFERENCE = 'STORE-ABCDEF0123456789'
PAYNOW_REFERENCE = 'PAYNOW-TEST-ONE'
POLL = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'


class WriterSQLTest(unittest.TestCase):
    def setUp(self):
        source = ROUTES.read_text()
        match = re.search(r'"(INSERT INTO store_paynow_status_observations\([^"\n]+)"', source)
        if match is None:
            self.fail('Missing the actual Store provider observation writer SQL')
        self.statement = match.group(1)
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SCHEMA.read_text())
        self.db.executescript(OBS_SCHEMA.read_text())
        self.db.execute("INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status) VALUES ('STORE_OWNER_TEST',425,'USD','first_party','approved')")
        self.db.execute("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES (?, 'SYNTHETIC_TEST','STORE_OWNER_TEST',425,'USD','initiating','2026-10-27T20:00:00Z','2026-10-28T20:00:00Z')", (REFERENCE,))
        self.db.execute("UPDATE store_checkout_intents SET status='pending',browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/1234',poll_url=? WHERE reference=?", (POLL,REFERENCE))
        self.args=['evt-'+('e'*64),REFERENCE,PAYNOW_REFERENCE,'Cancelled',425,POLL,'a'*64,'b'*64,'2026-10-27T21:00:00.000Z']

    def tearDown(self):
        self.db.close()

    def test_exact_worker_sql_atomically_inserts_matching_pending_observation(self):
        affected=self.db.execute(self.statement,self.args).rowcount
        self.assertEqual(affected,1)
        row=self.db.execute('SELECT provider_status,paynow_reference,callback_digest,poll_digest FROM store_paynow_status_observations').fetchone()
        self.assertEqual(row,('Cancelled',PAYNOW_REFERENCE,'a'*64,'b'*64))
        self.assertEqual(self.db.execute('SELECT status FROM store_checkout_intents').fetchone()[0],'pending')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_checkout_reviews').fetchone()[0],0)

    def test_exact_worker_sql_prevents_insert_after_manual_order_cancellation(self):
        self.db.execute("UPDATE store_checkout_intents SET status='cancelled' WHERE reference=?",(REFERENCE,))
        self.assertEqual(self.db.execute(self.statement,self.args).rowcount,0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)

    def test_exact_worker_sql_is_replay_immutable_even_with_reused_order_id(self):
        self.assertEqual(self.db.execute(self.statement,self.args).rowcount,1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(self.statement,self.args)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],1)

    def test_exact_worker_sql_rejects_altered_order_amount_or_poll_url(self):
        for modified in [(4,426),(5,'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-555555555555')]:
            with self.subTest(modified=modified):
                args=self.args.copy();args[modified[0]]=modified[1]
                self.assertEqual(self.db.execute(self.statement,args).rowcount,0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)

    def test_exact_worker_sql_disallows_unsanctioned_paid_or_refunded_observation(self):
        for state in ('Paid','Refunded','Unknown'):
            with self.subTest(state=state), self.assertRaises(sqlite3.IntegrityError):
                args=self.args.copy();args[3]=state
                self.db.execute(self.statement,args)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0],0)


if __name__=='__main__':
    unittest.main()
