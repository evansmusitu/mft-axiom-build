"""Local operator-lab regression, NEVER independent-operator qualification."""
import base64
import json
import multiprocessing as mp
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,NoEncryption
from ops.iso_trust_boundary.operator_lab_witness import LocalWitnessLab,WitnessHold,bootstrap_local_witness

def canon(x):
    return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def req(s='a'):
    return {'schema':'musitu.axiom.iso.s0.reservation-request.v1','receipt_sha256':s*64,
            'operation_id':'operation-'+s,'request_sha256':'b'*64,'nonce':s*32,
            'receipt_sequence':19}
def contender(path,key_bytes,queue):
    try:
        key=Ed25519PrivateKey.from_private_bytes(key_bytes)
        x=LocalWitnessLab(path,witness_id='witness-lab',epoch=2,signing_key=key,clock=lambda:112)
        queue.put('OK' if x.reserve_once(req())['record']['status']=='CONSUMED' else 'UNKNOWN')
    except WitnessHold:queue.put('HOLD')
class DurableWitnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.dir=Path(self.tmp.name);self.dir.chmod(0o700);self.db=str(self.dir/'witness.sqlite3')
        self.key=Ed25519PrivateKey.generate()
        bootstrap_local_witness(self.db,witness_id='witness-lab',epoch=2,
            signing_key=self.key,acknowledged_lab_only=True)
    def lab(self):
        return LocalWitnessLab(self.db,witness_id='witness-lab',epoch=2,
            signing_key=self.key,clock=lambda:112)
    def test_signed_real_sqlite_reservation(self):
        v=self.lab().reserve_once(req())
        self.key.public_key().verify(base64.b64decode(v['signature_b64'],validate=True),canon(v['record']))
        self.assertEqual(v['record']['status'],'CONSUMED')
        self.assertEqual(v['record']['consumed_index'],1)
    def test_process_restart_replay_denied(self):
        self.lab().reserve_once(req())
        with self.assertRaises(WitnessHold):self.lab().reserve_once(req())
    def test_operation_uniqueness_even_when_receipt_changes(self):
        self.lab().reserve_once(req())
        with self.assertRaises(WitnessHold):self.lab().reserve_once({**req('c'),'operation_id':'operation-a'})
    def test_missing_database_not_regenerated(self):
        self.lab().reserve_once(req());Path(self.db).unlink()
        with self.assertRaises(WitnessHold):self.lab().reserve_once(req())
    def test_db_snapshot_replay_blocked_if_anchor_preserved(self):
        saved=self.dir/'snapshot'
        shutil.copy2(self.db,saved)
        self.lab().reserve_once(req())
        shutil.copy2(saved,self.db)
        with self.assertRaises(WitnessHold):self.lab().reserve_once(req('c'))
    def test_tampered_anchor_denied(self):
        self.lab().reserve_once(req())
        anchor=Path(self.db+'.anchor');anchor.write_text('{}');anchor.chmod(0o600)
        with self.assertRaises(WitnessHold):self.lab().reserve_once(req('c'))
    def test_extra_input_and_wrong_signing_key_denied(self):
        with self.assertRaises(WitnessHold):self.lab().reserve_once({**req(),'production_authority':True})
        wrong=LocalWitnessLab(self.db,witness_id='witness-lab',epoch=2,
            signing_key=Ed25519PrivateKey.generate(),clock=lambda:112)
        with self.assertRaises(WitnessHold):wrong.reserve_once(req())
    def test_two_distinct_receipts_keep_monotonic_indexes(self):
        self.assertEqual(self.lab().reserve_once(req())['record']['consumed_index'],1)
        self.assertEqual(self.lab().reserve_once(req('c'))['record']['consumed_index'],2)
    def test_eight_spawned_workers_admit_exactly_once(self):
        key_bytes=self.key.private_bytes(Encoding.Raw,PrivateFormat.Raw,NoEncryption())
        ctx=mp.get_context('spawn');q=ctx.Queue()
        workers=[ctx.Process(target=contender,args=(self.db,key_bytes,q)) for _ in range(8)]
        for p in workers:p.start()
        for p in workers:
            p.join(timeout=20);self.assertEqual(p.exitcode,0)
        result=[q.get(timeout=5) for _ in workers]
        self.assertEqual(result.count('OK'),1);self.assertEqual(result.count('HOLD'),7)
    def test_total_local_storage_deletion_rebootstrap_still_replays_b27_attack(self):
        self.lab().reserve_once(req())
        for path in self.dir.iterdir():path.unlink()
        bootstrap_local_witness(self.db,witness_id='witness-lab',epoch=2,
            signing_key=self.key,acknowledged_lab_only=True)
        second=self.lab().reserve_once(req())
        self.assertEqual(second['record']['consumed_index'],1)
        self.assertEqual(second['record']['status'],'CONSUMED')
        # Attack succeeded. Passing test is proof of weakness, NOT security.
