"""Disconnected Store-only restore gap checks. No external services or keys."""
from __future__ import annotations
import hashlib
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SCHEMAS = [(HERE / 'store-axiom-checkout-schema.sql').read_text(),
           (HERE / 'store-paynow-status-observations.candidate.sql').read_text()]
REF = 'STORE-ABCDEF0123456789'
POLL = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'

@contextmanager
def disposable_sqlite(path):
    db=sqlite3.connect(path)
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


class RestoreComparisonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='store-v2-restore-gap-')
        self.addCleanup(self.tmp.cleanup)
        self.old = Path(self.tmp.name) / 'restored.sqlite'
        self.later = Path(self.tmp.name) / 'later.sqlite'
        with disposable_sqlite(self.old) as db:
            db.execute('PRAGMA foreign_keys=ON')
            for sql in SCHEMAS: db.executescript(sql)
            db.execute("INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status) VALUES ('OWNER_TEST',425,'USD','first_party','approved')")
            db.execute("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES (?,'TEST_CUSTOMER','OWNER_TEST',425,'USD','initiating','2026-10-29T08:00:00Z','2026-10-30T08:00:00Z')",(REF,))
            db.execute("UPDATE store_checkout_intents SET status='pending',poll_url=?,browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/TEST' WHERE reference=?",(POLL,REF))
            self.observe(db,'Cancelled','a'*64,'b'*64)
            db.commit()
        shutil.copy2(self.old,self.later)

    def observe(self,db,status,callback,poll_digest):
        provider = 'PAYNOW-ONE'
        event_id='evt-'+hashlib.sha256('\n'.join((REF,provider,callback,poll_digest)).encode()).hexdigest()
        db.execute("INSERT INTO store_paynow_status_observations(event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at) VALUES (?,?,?, ?,425,'USD',?,?,?,'2026-10-29T09:00:00.000Z')",(event_id,REF,provider,status,POLL,callback,poll_digest))
        return event_id

    def compare(self,restored=None,later=None):
        command=[sys.executable,str(HERE/'store_paynow_recovery_audit.py'),'--restored',str(restored or self.old),'--later',str(later or self.later)]
        proc=subprocess.run(command,capture_output=True,text=True,timeout=10,check=False)
        try: data=json.loads(proc.stdout)
        except ValueError: data={'non_json_stdout':proc.stdout,'stderr':proc.stderr}
        return proc,data

    def test_identical_qualified_snapshots_report_equivalence_but_no_authority(self):
        proc,report=self.compare()
        self.assertEqual(proc.returncode,0,report)
        self.assertEqual(report['status'],'equivalent')
        self.assertEqual(report['missing_observations'],0)
        self.assertEqual(report['missing_reviews'],0)
        self.assertFalse(report['restore_authorized'])
        self.assertFalse(report['payment_authorized'])
        self.assertNotIn(REF,json.dumps(report))
        self.assertNotIn(POLL,json.dumps(report))

    def test_later_observation_is_detected_as_missing_from_restored_snapshot(self):
        with disposable_sqlite(self.later) as db:
            self.observe(db,'Disputed','c'*64,'d'*64)
        before=self.old.read_bytes()
        proc,report=self.compare()
        self.assertEqual(proc.returncode,2,report)
        self.assertEqual(report['status'],'manual_reconciliation_required')
        self.assertEqual(report['missing_observations'],1)
        self.assertTrue(report['provider_reconciliation_required'])
        self.assertEqual(self.old.read_bytes(),before)
        self.assertNotIn(REF,json.dumps(report))

    def test_later_paid_review_requires_manual_reconciliation_not_entitlement(self):
        with disposable_sqlite(self.later) as db:
            db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ONE','review_required',?,?,'2026-10-29T09:00:00Z')",(REF,'c'*64,'d'*64))
            db.execute("UPDATE store_checkout_intents SET status='review_required' WHERE reference=?",(REF,))
        proc,report=self.compare()
        self.assertEqual(proc.returncode,2,report)
        self.assertEqual(report['status'],'manual_reconciliation_required')
        self.assertEqual(report['missing_reviews'],1)
        self.assertGreaterEqual(report['changed_checkout_states'],1)
        self.assertFalse(report['payment_authorized'])

    def test_reverse_time_direction_is_conflict_not_permission_to_erase_evidence(self):
        with disposable_sqlite(self.old) as db:
            self.observe(db,'Disputed','c'*64,'d'*64)
        proc,report=self.compare()
        self.assertEqual(proc.returncode,1,report)
        self.assertEqual(report['status'],'conflict')
        self.assertEqual(report['restored_only_observations'],1)
        self.assertFalse(report['restore_authorized'])

    def test_same_event_id_but_mutated_status_is_hard_conflict(self):
        with disposable_sqlite(self.later) as db:
            trigger_sql=db.execute("SELECT sql FROM sqlite_master WHERE name='store_paynow_observation_no_update'").fetchone()[0]
            db.execute('DROP TRIGGER store_paynow_observation_no_update')
            db.execute("UPDATE store_paynow_status_observations SET provider_status='Disputed'")
            db.execute(trigger_sql)
        proc,report=self.compare()
        self.assertEqual(proc.returncode,1,report)
        self.assertEqual(report['status'],'conflict')
        self.assertEqual(report['changed_existing_observations'],1)

    def test_unqualified_comparison_rejects_missing_immutability(self):
        with disposable_sqlite(self.later) as db:
            db.execute('DROP TRIGGER store_paynow_observation_no_delete')
        proc,report=self.compare()
        self.assertEqual(proc.returncode,1,report)
        self.assertEqual(report['status'],'unqualified_snapshot')
        self.assertFalse(report['restore_authorized'])
        self.assertIn('schema_drift',report['later_failures'])

    def test_missing_input_rejected_and_no_database_created(self):
        missing=Path(self.tmp.name)/'not-there.sqlite'
        proc,report=self.compare(later=missing)
        self.assertEqual(proc.returncode,1,report)
        self.assertEqual(report['status'],'unqualified_snapshot')
        self.assertFalse(missing.exists())

    def test_future_snapshot_new_checkout_is_manual_not_auto_replay(self):
        with disposable_sqlite(self.later) as db:
            db.execute("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES ('STORE-ABCDEF0123456790','TEST_CUSTOMER','OWNER_TEST',425,'USD','initiating','2026-10-29T08:00:00Z','2026-10-30T08:00:00Z')")
        proc,report=self.compare()
        self.assertEqual(proc.returncode,2,report)
        self.assertEqual(report['status'],'manual_reconciliation_required')
        self.assertEqual(report['missing_checkout_intents'],1)

if __name__=='__main__': unittest.main()
