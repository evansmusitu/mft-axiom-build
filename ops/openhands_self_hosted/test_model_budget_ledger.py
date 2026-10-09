"""Durable per-capability model-call budget tests. No model access is performed."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import tempfile
import unittest

from model_budget_ledger import SqliteBudgetLedger, BudgetExhausted, BudgetLedgerUnavailable


class BudgetLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'broker_budget.sqlite3'
        self.nonce='a'*32
        self.binding='f'*64

    def ledger(self):
        return SqliteBudgetLedger(self.path)

    def test_reservation_survives_broker_restart(self):
        first=self.ledger()
        self.assertEqual(first.reserve(nonce=self.nonce,binding=self.binding,max_calls=2),1)
        second=self.ledger()
        self.assertEqual(second.reserve(nonce=self.nonce,binding=self.binding,max_calls=2),2)
        with self.assertRaises(BudgetExhausted):
            self.ledger().reserve(nonce=self.nonce,binding=self.binding,max_calls=2)

    def test_nonce_conflict_fails_closed(self):
        l=self.ledger()
        l.reserve(nonce=self.nonce,binding=self.binding,max_calls=2)
        for change in ({'nonce':self.nonce,'binding':'1'*64,'max_calls':2},
                       {'nonce':self.nonce,'binding':self.binding,'max_calls':3}):
            with self.subTest(change=change),self.assertRaises(BudgetExhausted):
                l.reserve(**change)

    def test_bad_identifiers_fail_before_disk_access(self):
        for args in [
            {'nonce':'../secrets','binding':self.binding,'max_calls':2},
            {'nonce':self.nonce,'binding':'x'*64,'max_calls':2},
            {'nonce':self.nonce,'binding':self.binding,'max_calls':0},
            {'nonce':self.nonce,'binding':self.binding,'max_calls':True},
        ]:
            with self.subTest(args=args),self.assertRaises(BudgetExhausted):
                self.ledger().reserve(**args)
        self.assertFalse(self.path.exists())

    def test_concurrent_multi_instance_reservations_atomic(self):
        def attempt(_):
            try:
                return self.ledger().reserve(nonce=self.nonce,binding=self.binding,max_calls=2)
            except BudgetExhausted:
                return None
        with ThreadPoolExecutor(max_workers=12) as pool:
            values=list(pool.map(attempt,range(20)))
        self.assertEqual(sorted(x for x in values if x is not None),[1,2])

    def test_private_file_permissions_and_no_secret_content(self):
        self.ledger().reserve(nonce=self.nonce,binding=self.binding,max_calls=1)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(b'Bearer ',self.path.read_bytes())

    def test_symlink_to_existing_database_denied(self):
        destination=Path(self.temp.name)/'destination.sqlite3'
        destination.write_bytes(b'untouched')
        self.path.symlink_to(destination)
        with self.assertRaises(BudgetLedgerUnavailable):
            self.ledger().reserve(nonce=self.nonce,binding=self.binding,max_calls=1)
        self.assertEqual(destination.read_bytes(),b'untouched')


if __name__=='__main__':
    unittest.main()
