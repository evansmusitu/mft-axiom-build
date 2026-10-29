"""Fail-closed disposable Store V2 observation recovery audit tests.

All fixtures are synthetic local SQLite files: no Neon, Cloudflare, Paynow,
actual customer identities, publisher payments or live connection strings.
"""
from __future__ import annotations

import json
import hashlib
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

from store.phase1.payments.store_paynow_recovery_audit import audit_snapshot

HERE = Path(__file__).resolve().parent
BASE = (HERE / 'store-axiom-checkout-schema.sql').read_text()
OBS = (HERE / 'store-paynow-status-observations.candidate.sql').read_text()
POLL1 = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444'
POLL2 = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-555555555555'
REF1 = 'STORE-ABCDEF0123456789'
REF2 = 'STORE-ABCDEF0123456790'


class ObservationRecoveryAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='store-v2-disposable-recovery-')
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'source.sqlite'
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(BASE)
        self.db.executescript(OBS)
        self.db.execute("INSERT INTO store_products(sku,amount_cents,currency,publisher_type,status) VALUES ('OWNER_TEST',425,'USD','first_party','approved')")
        for reference, poll in [(REF1,POLL1),(REF2,POLL2)]:
            self.db.execute("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES (?,'TEST_CUSTOMER','OWNER_TEST',425,'USD','initiating','2026-10-29T08:00:00Z','2026-10-30T08:00:00Z')",(reference,))
            self.db.execute("UPDATE store_checkout_intents SET status='pending',poll_url=?,browser_url='https://www.paynow.co.zw/Payment/ConfirmPayment/TEST' WHERE reference=?",(poll,reference))
        self.observe('evt-first', 'Cancelled', 'a'*64, 'b'*64)
        self.db.commit()

    def observe(self, event_id, state, callback, polled, ref=REF1, poll=POLL1, provider='PAYNOW-ONE'):
        event_id = 'evt-' + hashlib.sha256('\n'.join((ref,provider,callback,polled)).encode()).hexdigest()
        self.db.execute("INSERT INTO store_paynow_status_observations(event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at) VALUES (?,?,?,?,425,'USD',?,?,?,'2026-10-29T09:00:00.000Z')",
                        (event_id,ref,provider,state,poll,callback,polled))

    def test_good_snapshot_is_read_only_qualified_and_redacted(self):
        before = self.path.read_bytes()
        report = audit_snapshot(self.path)
        self.assertTrue(report['qualified'],report)
        self.assertEqual(report['failures'],[])
        self.assertEqual(report['observations'],1)
        self.assertEqual(report['reviews'],0)
        self.assertEqual(len(report['observation_fingerprint_sha256']),64)
        self.assertEqual(before,self.path.read_bytes())
        self.assertNotIn(REF1,json.dumps(report))
        self.assertNotIn('PAYNOW-ONE',json.dumps(report))

    def test_bare_unmigrated_store_snapshot_fails_closed(self):
        self.db.executescript('DROP TABLE store_paynow_status_observations;')
        self.db.commit()
        report = audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('schema_drift',report['failures'])

    def test_dropped_immutability_trigger_fails_even_without_rows(self):
        self.db.executescript('DROP TRIGGER store_paynow_observation_no_delete;')
        self.db.commit()
        report = audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('schema_drift',report['failures'])

    def test_altered_existing_trigger_detected_even_if_object_name_unchanged(self):
        self.db.executescript('DROP TRIGGER store_paynow_observation_no_update; CREATE TRIGGER store_paynow_observation_no_update BEFORE UPDATE ON store_paynow_status_observations BEGIN SELECT 1; END;')
        self.db.commit()
        self.assertIn('schema_drift',audit_snapshot(self.path)['failures'])

    def test_torn_review_batch_detected_by_separate_order_state(self):
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ONE','review_required',?,?,'2026-10-29T09:00:00Z')",(REF1,'c'*64,'d'*64))
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('review_intent_state_conflict',report['failures'])

    def test_reverse_cross_order_reference_conflict_detected_in_tampered_snapshot(self):
        # The production candidate trigger denies this; emulate an incomplete
        # legacy database and prove the independent auditor catches it.
        self.db.executescript('DROP TRIGGER store_paynow_observation_no_reverse_review_claim;')
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES (?,'PAYNOW-ONE','review_required',?,?,'2026-10-29T09:00:00Z')",(REF2,'c'*64,'d'*64))
        self.db.execute("UPDATE store_checkout_intents SET status='review_required' WHERE reference=?",(REF2,))
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('schema_drift',report['failures'])
        self.assertIn('provider_reference_conflict',report['failures'])

    def test_invalid_order_identity_detected_despite_missing_legacy_trigger(self):
        self.db.executescript('DROP TRIGGER store_paynow_observation_order_identity;')
        self.observe('evt-wrong', 'Disputed', 'c'*64,'d'*64,ref=REF2,poll=POLL1,provider='PAYNOW-TWO')
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('order_observation_identity_conflict',report['failures'])

    def test_disposable_snapshot_backup_restore_produces_matching_fingerprint(self):
        first=audit_snapshot(self.path)
        backup=Path(self.tmp.name)/'offline-backup.sqlite'
        with sqlite3.connect(backup) as target:
            self.db.backup(target)
        self.observe('evt-second','Disputed','c'*64,'d'*64)
        self.db.commit()
        self.assertNotEqual(audit_snapshot(self.path)['observation_fingerprint_sha256'],first['observation_fingerprint_sha256'])
        # Restore into a fresh local path, never overwrite a deployed system.
        restored=Path(self.tmp.name)/'offline-restored.sqlite'
        shutil.copy2(backup,restored)
        checked=audit_snapshot(restored)
        self.assertTrue(checked['qualified'],checked)
        self.assertEqual(checked['observation_fingerprint_sha256'],first['observation_fingerprint_sha256'])
        self.assertEqual(checked['observations'],first['observations'])

    def test_event_id_must_match_callback_and_poll_evidence(self):
        self.db.execute("INSERT INTO store_paynow_status_observations(event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at) VALUES ('evt-wrong',?,'PAYNOW-ONE','Disputed',425,'USD',?, ?,?,'2026-10-29T09:00:00.000Z')",
                        (REF1,POLL1,'c'*64,'d'*64))
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('observation_event_identity_conflict',report['failures'])

    def test_foreign_key_check_rejects_orphaned_review_in_legacy_snapshot(self):
        self.db.execute('PRAGMA foreign_keys=OFF')
        self.db.executescript('DROP TRIGGER store_provider_claim_pending_only;')
        self.db.execute("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) VALUES ('STORE-NONEXISTENT123456','PAYNOW-ORPHAN','review_required',?,?,'2026-10-29T09:00:00Z')",('e'*64,'f'*64))
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('foreign_key_conflict',report['failures'])
        self.assertIn('review_intent_state_conflict',report['failures'])

    def test_unreviewed_payout_table_is_not_a_qualified_candidate_snapshot(self):
        self.db.execute('CREATE TABLE store_publisher_payouts (id TEXT PRIMARY KEY, amount INTEGER)')
        self.db.commit()
        report=audit_snapshot(self.path)
        self.assertFalse(report['qualified'])
        self.assertIn('unreviewed_schema_object',report['failures'])

    def test_readonly_cli_emits_no_reference_and_returns_correct_exit_code(self):
        import subprocess,sys
        cmd=[sys.executable,str(HERE/'store_paynow_recovery_audit.py'),'--snapshot',str(self.path)]
        ok=subprocess.run(cmd,check=False,capture_output=True,text=True,timeout=5)
        self.assertEqual(ok.returncode,0,ok.stderr)
        self.assertTrue(json.loads(ok.stdout)['qualified'])
        self.assertNotIn(REF1,ok.stdout)
        self.db.executescript('DROP TRIGGER store_paynow_observation_no_delete;')
        self.db.commit()
        fail=subprocess.run(cmd,check=False,capture_output=True,text=True,timeout=5)
        self.assertEqual(fail.returncode,1)
        self.assertIn('schema_drift',json.loads(fail.stdout)['failures'])

    def test_audit_receipt_does_not_authorize_payment_deployment_or_settlement(self):
        report=audit_snapshot(self.path)
        self.assertTrue(report['qualified'])
        self.assertEqual(report['scope'],'local_sqlite_snapshot_only')
        self.assertFalse(report['deployment_authorized'])
        self.assertFalse(report['money_movement_authorized'])

    def test_unavailable_path_never_creates_database(self):
        missing=Path(self.tmp.name)/'does-not-exist.sqlite'
        result=audit_snapshot(missing)
        self.assertFalse(result['qualified'])
        self.assertIn('snapshot_unavailable',result['failures'])
        self.assertFalse(missing.exists())

    def test_broken_sqlite_returns_failure_without_raw_database_contents(self):
        broken=Path(self.tmp.name)/'broken.sqlite'
        broken.write_bytes(b'not a SQLite file: private customer 12345')
        result=audit_snapshot(broken)
        self.assertFalse(result['qualified'])
        self.assertIn('snapshot_invalid',result['failures'])
        self.assertNotIn('12345',json.dumps(result))


if __name__=='__main__':
    unittest.main()
