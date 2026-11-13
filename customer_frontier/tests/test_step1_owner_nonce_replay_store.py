import importlib.util
import json
import os
import pathlib
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PATH=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_owner_nonce_replay_store.py'
spec=importlib.util.spec_from_file_location('axiom_owner_nonce_replay_store',PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def good():
    return {'schema':m.SCHEMA,'source_account':m.SOURCE_ACCOUNT,'source_database':m.SOURCE_D1,
            'governance_amendment_sha256':m.AMENDMENT_SHA,'plan_sha256':'a'*64,
            'signer_spki_sha256':'b'*64,'nonce':'c'*32,'issued_at':'2026-11-13T05:00:00.000Z',
            'expires_at':'2026-11-13T05:15:00.000Z',
            'signature_verification_status':'PINNED_OWNER_SIGNATURE_VALID_POLICY_PROPOSAL_ONLY_NO_GO',
            'step1_closed':False,'release_status':'NOT_RELEASE'}

class TestReplayStore(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='axiom-nonce-ledger-')
        self.addCleanup(self.tmp.cleanup)
        self.root=pathlib.Path(self.tmp.name)
        self.ledger=self.root/'private'
        self.ledger.mkdir(mode=0o700)
    def reject(self,code,attempt=None,where=None):
        with self.assertRaises(m.NoGo) as e:m.reserve(where or self.ledger,attempt or good())
        self.assertEqual(str(e.exception),code)
    def test_success_receipt_never_grants_provider_authority(self):
        r=m.reserve(self.ledger,good())
        self.assertTrue(r['local_durable_nonce_commit_observed'])
        self.assertFalse(r['global_anti_rollback_qualified'])
        self.assertFalse(r['release_authorized'])
        self.assertEqual(r['release_status'],'NOT_RELEASE')
        self.assertEqual(r['local_ledger_nonce_count'],1)
    def test_duplicate_exact_rejected_after_closed_connection(self):
        m.reserve(self.ledger,good())
        self.reject('NONCE_OR_EXACT_PROPOSAL_ALREADY_CONSUMED_NO_GO')
    def test_same_nonce_different_plan_rejected(self):
        m.reserve(self.ledger,good());data=good();data['plan_sha256']='d'*64
        self.reject('NONCE_OR_EXACT_PROPOSAL_ALREADY_CONSUMED_NO_GO',data)
    def test_same_plan_hash_new_nonce_rejected(self):
        m.reserve(self.ledger,good());data=good();data['nonce']='d'*32
        self.reject('NONCE_OR_EXACT_PROPOSAL_ALREADY_CONSUMED_NO_GO',data)
    def test_new_nonce_and_new_hash_accepted(self):
        m.reserve(self.ledger,good());data=good();data['nonce']='e'*32;data['plan_sha256']='d'*64
        self.assertEqual(m.reserve(self.ledger,data)['local_ledger_nonce_count'],2)
    def test_extra_or_missing_fields_rejected_without_disk_mutation(self):
        d=good();d['authorize']=True;self.reject('UNREVIEWED_ATTEMPT_FIELDS',d)
        d=good();del d['nonce'];self.reject('UNREVIEWED_ATTEMPT_FIELDS',d)
        self.assertFalse((self.ledger/m.DB_NAME).exists())
    def test_bypass_attestation_status_denied(self):
        d=good();d['signature_verification_status']='PASS';self.reject('UNVERIFIED_SIGNATURE_OR_RELEASE_DRIFT',d)
        d=good();d['step1_closed']=True;self.reject('UNVERIFIED_SIGNATURE_OR_RELEASE_DRIFT',d)
    def test_source_and_amendment_drift_denied(self):
        d=good();d['source_database']='fake';self.reject('UNEXPECTED_SOURCE_OR_POLICY',d)
        d=good();d['governance_amendment_sha256']='0'*64;self.reject('UNEXPECTED_SOURCE_OR_POLICY',d)
    def test_time_window_and_noncanonical_date_denied(self):
        d=good();d['expires_at']='2026-11-15T05:00:00.000Z';self.reject('INVALID_PROPOSAL_WINDOW',d)
        d=good();d['issued_at']='2026-11-13T05:00:00Z';self.reject('NONCANONICAL_TIME',d)
    def test_symlink_directory_denied(self):
        alias=self.root/'alias';alias.symlink_to(self.ledger,target_is_directory=True)
        self.reject('OWNER_NONCE_DIR_INVALID',where=alias)
    def test_insecure_directory_mode_denied(self):
        self.ledger.chmod(0o755);self.reject('OWNER_NONCE_DIR_UNSAFE')
    def test_insecure_db_mode_denied(self):
        m.reserve(self.ledger,good());(self.ledger/m.DB_NAME).chmod(0o644)
        d=good();d['nonce']='d'*32;d['plan_sha256']='d'*64
        self.reject('NONCE_DB_PERMISSIONS_UNSAFE',d)
    def test_db_symlink_and_hardlink_denied(self):
        other=self.root/'other';other.write_bytes(b'fake')
        (self.ledger/m.DB_NAME).symlink_to(other)
        self.reject('UNSAFE_OR_LINKED_NONCE_DB')
        (self.ledger/m.DB_NAME).unlink();os.link(other,self.ledger/m.DB_NAME)
        self.reject('UNSAFE_OR_LINKED_NONCE_DB')
    def test_schema_tampering_denied_and_no_second_nonce(self):
        m.reserve(self.ledger,good());db=self.ledger/m.DB_NAME
        with sqlite3.connect(db) as conn:conn.execute('ALTER TABLE consumed_owner_proposals ADD COLUMN unreviewed TEXT')
        d=good();d['nonce']='d'*32;d['plan_sha256']='d'*64
        self.reject('LEDGER_SCHEMA_DRIFT',d)
    def test_direct_python_cli_malformed_input_exits_two(self):
        p=subprocess.run([sys.executable,str(PATH),str(self.ledger)],input=b'{oops}',capture_output=True)
        self.assertEqual(p.returncode,2);self.assertIn(b'AXIOM_OWNER_LOCAL_NONCE_NO_GO',p.stderr)
    def test_a_local_db_snapshot_rollback_is_not_globally_prevented(self):
        # Explicit negative demonstration: local SQLite alone cannot enforce global anti-rollback.
        m.reserve(self.ledger,good());db=self.ledger/m.DB_NAME
        old=db.read_bytes(); d=good();d['nonce']='d'*32;d['plan_sha256']='d'*64
        m.reserve(self.ledger,d);db.write_bytes(old)
        r=m.reserve(self.ledger,d)
        self.assertFalse(r['global_anti_rollback_qualified'])
        self.assertEqual(r['local_ledger_nonce_count'],2)
if __name__=='__main__':unittest.main()

# Additional tests are defined in a separate unittest class so test discovery
# includes them despite the original module's guarded __main__ below.
class TestAdditionalReplaySafety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='axiom-nonce-concurrent-')
        self.addCleanup(self.tmp.cleanup)
        self.ledger=pathlib.Path(self.tmp.name)/'owner-private'
        self.ledger.mkdir(mode=0o700)
    def test_atomic_duplicate_under_concurrent_processes(self):
        m.reserve(self.ledger,good())
        data=good();data['nonce']='d'*32;data['plan_sha256']='d'*64
        payload=json.dumps(data).encode()
        from concurrent.futures import ThreadPoolExecutor
        def worker():
            return subprocess.run([sys.executable,str(PATH),str(self.ledger)],input=payload,capture_output=True,timeout=12)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda _:worker(),range(2)))
        self.assertEqual(sorted(r.returncode for r in results),[0,2])
        self.assertTrue(any(b'ALREADY_CONSUMED' in r.stderr for r in results))
        with sqlite3.connect(self.ledger/m.DB_NAME) as db:
            self.assertEqual(db.execute('SELECT count(1) FROM consumed_owner_proposals').fetchone()[0],2)
    def test_forged_schema_with_wrong_unique_indices_denies(self):
        db=self.ledger/m.DB_NAME
        with sqlite3.connect(db) as conn:
            conn.executescript('''CREATE TABLE consumed_owner_proposals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_account TEXT NOT NULL,source_database TEXT NOT NULL,signer_pin TEXT NOT NULL,
                proposal_nonce TEXT NOT NULL,exact_plan_sha256 TEXT NOT NULL UNIQUE,observed_at TEXT NOT NULL,
                UNIQUE(source_account, signer_pin,proposal_nonce)
            );PRAGMA user_version=1;''')
        db.chmod(0o600)
        with self.assertRaises(m.NoGo) as caught:m.reserve(self.ledger,good())
        self.assertIn(str(caught.exception),('LEDGER_EXACT_SCHEMA_OR_UNIQUENESS_UNQUALIFIED','LEDGER_UNIQUENESS_UNQUALIFIED'))
