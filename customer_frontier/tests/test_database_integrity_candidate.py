"""Negative SQLite tests for candidate D1 schema. NO remote database access."""
import sqlite3
import unittest
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1] / "customer_control_plane" / "schema.sql"

class DBIntegrity(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA.read_text())
        self.db.execute("INSERT INTO tenants(id,name) VALUES('t1','One'),('t2','Two')")
        self.db.execute("INSERT INTO identities(id,issuer,external_sub) VALUES('i1','issuer','a'),('i2','issuer','b')")
        self.db.execute("INSERT INTO memberships(tenant_id,identity_id,role) VALUES('t1','i1','owner'),('t2','i2','owner')")
        self.db.execute("INSERT INTO price_catalog(id,name,currency,amount_minor,grant_units,enabled) VALUES('dev','Developer','USD',1900,1000,1)")
        self.db.execute("INSERT INTO orders(id,tenant_id,identity_id,price_id,amount_minor,currency,grant_units,client_key) VALUES('o1','t1','i1','dev',1900,'USD',1000,'c1')")

    def tearDown(self):
        self.db.close()

    def test_reject_wrong_catalog_economics(self):
        for amount,currency,units in [(1901,'USD',1000),(1900,'EUR',1000),(1900,'USD',1001)]:
            with self.subTest(amount=amount,currency=currency,units=units):
                with self.assertRaisesRegex(sqlite3.IntegrityError,"order_catalog_economics_mismatch"):
                    self.db.execute("INSERT INTO orders(id,tenant_id,identity_id,price_id,amount_minor,currency,grant_units,client_key) VALUES(?,?,?,?,?,?,?,?)",("bad","t1","i1","dev",amount,currency,units,"bad"))

    def test_purchased_price_immutability_and_disable(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,"catalog_purchased_economics_immutable"):
            self.db.execute("UPDATE price_catalog SET amount_minor=1 WHERE id='dev'")
        self.db.execute("UPDATE price_catalog SET enabled=0 WHERE id='dev'")
        self.assertEqual(self.db.execute("SELECT amount_minor,enabled FROM price_catalog WHERE id='dev'").fetchone(),(1900,0))

    def test_mismatched_provider_currency_or_settlement_amount(self):
        for amount,currency in [(1900,'EUR'),(1800,'USD')]:
            with self.subTest(amount=amount,currency=currency):
                with self.assertRaisesRegex(sqlite3.IntegrityError,"provider_event_order_economics_mismatch"):
                    self.db.execute("INSERT INTO provider_events(event_id,provider,provider_transaction_id,order_id,kind,amount_minor,currency) VALUES(?,?,?,?,?,?,?)",("bad","paynow","tx-bad","o1","settlement",amount,currency))

    def test_one_settlement_event_grants_exact_units_once(self):
        self.db.execute("INSERT INTO provider_events(event_id,provider,provider_transaction_id,order_id,kind,amount_minor,currency) VALUES('e1','paynow','tx1','o1','settlement',1900,'USD')")
        with self.assertRaisesRegex(sqlite3.IntegrityError,"provider_credit_amount_mismatch"):
            self.db.execute("INSERT INTO credit_ledger(id,tenant_id,delta,source_key,event_id) VALUES('bad','t1',9000,'bad','e1')")
        self.db.execute("INSERT INTO credit_ledger(id,tenant_id,delta,source_key,event_id) VALUES('l1','t1',1000,'one','e1')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO credit_ledger(id,tenant_id,delta,source_key,event_id) VALUES('l2','t1',1000,'two','e1')")
        self.db.execute("UPDATE orders SET state='settled' WHERE id='o1'")

    def test_cross_tenant_author_denied(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO projects(id,tenant_id,name,objective,created_by) VALUES('p1','t2','cross','deny','i1')")

    def test_order_immutable_and_terminal_transition(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,"order_economics_immutable"):
            self.db.execute("UPDATE orders SET currency='EUR' WHERE id='o1'")
        self.db.execute("UPDATE orders SET state='void' WHERE id='o1'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,"order_terminal_state_immutable"):
            self.db.execute("UPDATE orders SET state='pending' WHERE id='o1'")

    def test_refund_currency_must_match(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,"provider_event_order_economics_mismatch"):
            self.db.execute("INSERT INTO provider_events(event_id,provider,provider_transaction_id,order_id,kind,amount_minor,currency) VALUES('rf1','paynow','rf1','o1','refund',500,'EUR')")

if __name__ == "__main__":
    unittest.main()
