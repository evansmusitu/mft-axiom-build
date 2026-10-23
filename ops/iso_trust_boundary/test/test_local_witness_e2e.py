"""Real S0 integration tests: Ed25519 operator receipt → local SQLite witness.

No independent witness, no provider egress, no production authority.
Destructive local rollback replay MUST remain a reproduced negative test.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.verify_operator_receipt import ReceiptVerifier, ReceiptHold
from ops.iso_trust_boundary.reservation_boundary import ReservationBoundary
from ops.iso_trust_boundary.operator_lab_witness import bootstrap_local_witness, LocalWitnessLab


def canonical(item):
    return json.dumps(item,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()


class RealLocalWitnessIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name)
        self.parent.chmod(0o700)
        self.db=str(self.parent/'operator-lab.sqlite3')
        self.operator_key=Ed25519PrivateKey.generate()
        self.witness_key=Ed25519PrivateKey.generate()
        pub=lambda key:key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.pub=pub
        self.expected={'operation_id':'operation-a','project_id':'project-a','work_id':'work-a',
                       'workload_identity_id':'agent-a','request_sha256':'b'*64,
                       'nonce':'c'*32,'risk_class':'S3'}
        self.receipt={'schema':'musitu.axiom.iso.s0.receipt.v1',
                      'operator_id':'operator-lab','key_epoch':7,'policy_sha256':'a'*64,
                      **self.expected,'decision':'ALLOW','sequence':19,
                      'issued_at_unix':100,'expires_at_unix':125}
        bootstrap_local_witness(self.db,witness_id='witness-lab',epoch=2,
                                signing_key=self.witness_key,acknowledged_lab_only=True)
        self.op_verifier=ReceiptVerifier(pinned_operator_id='operator-lab',
            pinned_public_key=pub(self.operator_key),pinned_policy_sha256='a'*64,
            pinned_key_epoch=7,clock=lambda:112.0)

    def lab(self):
        return LocalWitnessLab(self.db,witness_id='witness-lab',
            epoch=2,signing_key=self.witness_key,clock=lambda:111.0)

    def boundary(self, adapter=None, verifier=None):
        return ReservationBoundary(receipt_verifier=verifier or self.op_verifier,
            witness_id='witness-lab',witness_public_key=self.pub(self.witness_key),
            witness_epoch=2,reserve_once=adapter or self.lab().reserve_once,
            clock=lambda:112.0)

    def signature(self,receipt=None,key=None):
        return base64.b64encode((key or self.operator_key).sign(
            canonical(receipt or self.receipt))).decode('ascii')

    def probe(self,boundary=None,receipt=None,signature=None,expected=None):
        return (boundary or self.boundary()).probe(
            receipt=receipt or self.receipt,
            receipt_signature_b64=signature or self.signature(receipt),
            expected=expected or self.expected)

    def test_exact_signed_flow_persists_and_returns_only_non_authorizing_evidence(self):
        result=self.probe()
        self.assertEqual(result['status'],'S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY')
        self.assertEqual(result['operator_signature'],'VALID_S0')
        self.assertEqual(result['witness_signature'],'VALID_S0')
        self.assertFalse(result['execution_allowed'])
        self.assertFalse(result['provider_dispatch_allowed'])
        self.assertFalse(result['production_authority'])
        self.assertEqual(result['independent_global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_restart_rejects_same_receipt_and_preserves_consumed_history(self):
        first=self.probe()
        self.assertTrue(first['witness_record_sha256'])
        with self.assertRaises(ReceiptHold):
            self.probe(boundary=self.boundary(adapter=self.lab().reserve_once))

    def test_eight_simultaneous_requests_reserve_exactly_once(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes=list(pool.map(lambda _ :self.try_probe(),range(8)))
        self.assertEqual(outcomes.count('EVIDENCE'),1)
        self.assertEqual(outcomes.count('HOLD'),7)

    def try_probe(self):
        try:
            self.probe()
            return 'EVIDENCE'
        except ReceiptHold:
            return 'HOLD'

    def test_lost_ack_after_sqlite_commit_never_reissues_a_grant(self):
        def drop_after_commit(req):
            self.lab().reserve_once(req)
            raise ConnectionError('synthetic response lost after durable reservation')
        with self.assertRaises(ReceiptHold):
            self.probe(boundary=self.boundary(adapter=drop_after_commit))
        with self.assertRaises(ReceiptHold):
            self.probe()
        # Even a successful proof would never authorize a public/production effect.

    def test_invalid_operator_signature_is_rejected_before_witness_write(self):
        alien=Ed25519PrivateKey.generate()
        with self.assertRaises(ReceiptHold):
            self.probe(signature=self.signature(key=alien))
        self.assertEqual(self.probe()['status'],
                         'S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY')

    def test_deleting_all_same_host_storage_reenables_replay_counterexample(self):
        first=self.probe()
        for candidate in self.parent.iterdir():
            candidate.unlink()
        bootstrap_local_witness(self.db,witness_id='witness-lab',epoch=2,
                                signing_key=self.witness_key,acknowledged_lab_only=True)
        second=self.probe()
        self.assertEqual(first['status'],second['status'])
        self.assertEqual(first['independent_global_antirollback'],
                         'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(second['independent_global_antirollback'],
                         'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertFalse(second['execution_allowed'])


if __name__=='__main__':
    unittest.main()
