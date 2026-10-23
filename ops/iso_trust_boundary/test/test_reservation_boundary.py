"""Synthetic-only tests; real independent witness custody is never claimed."""
import base64
import hashlib
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.verify_operator_receipt import ReceiptVerifier, ReceiptHold
from ops.iso_trust_boundary.reservation_boundary import ReservationBoundary

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

class FakeIndependentWitness:
    """Test double only: same-process storage is fully rollbackable."""
    def __init__(self,key,*,time=111):
        self.key=key
        self.time=time
        self.consumed=set()
        self.lock=threading.Lock()
        self.calls=0
        self.drop=False
        self.bad=None

    def reserve_once(self, request):
        with self.lock:
            self.calls+=1
            if self.drop:
                raise ConnectionError('lost ACK after unknown commit')
            digest=request['receipt_sha256']
            if digest in self.consumed:
                raise ValueError('already consumed')
            self.consumed.add(digest)
            record={'schema':'musitu.axiom.iso.s0.consumption-witness.v1',
                    'witness_id':'witness-a','witness_epoch':2,
                    'receipt_sha256':digest,'operation_id':request['operation_id'],
                    'request_sha256':request['request_sha256'],'nonce':request['nonce'],
                    'receipt_sequence':request['receipt_sequence'],
                    'consumed_index':len(self.consumed),'status':'CONSUMED',
                    'issued_at_unix':self.time,'expires_at_unix':self.time+12}
            if self.bad:
                record.update(self.bad)
            return {'record':record,'signature_b64':base64.b64encode(self.key.sign(canonical(record))).decode()}

class ReservationBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.operator=Ed25519PrivateKey.generate()
        self.witness_key=Ed25519PrivateKey.generate()
        self.wrong=Ed25519PrivateKey.generate()
        pub=lambda k:k.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.pub=pub
        self.clock=[112.0]
        self.expected={'operation_id':'op-123','project_id':'project-1','work_id':'work-1',
            'workload_identity_id':'agent-work-1','request_sha256':'b'*64,
            'nonce':'c'*32,'risk_class':'S3'}
        self.receipt={'schema':'musitu.axiom.iso.s0.receipt.v1',
            'operator_id':'operator-a','key_epoch':7,'policy_sha256':'a'*64,
            **self.expected,'decision':'ALLOW','sequence':19,
            'issued_at_unix':100,'expires_at_unix':125}
        self.sign=lambda:base64.b64encode(self.operator.sign(canonical(self.receipt))).decode()
        self.verifier=ReceiptVerifier(pinned_operator_id='operator-a',pinned_public_key=pub(self.operator),
            pinned_policy_sha256='a'*64,pinned_key_epoch=7,clock=lambda:self.clock[0])
        self.backend=FakeIndependentWitness(self.witness_key)
        self.boundary=ReservationBoundary(receipt_verifier=self.verifier,
            witness_id='witness-a',witness_public_key=pub(self.witness_key),
            witness_epoch=2,reserve_once=self.backend.reserve_once,clock=lambda:self.clock[0])

    def call(self,**kwargs):
        return self.boundary.probe(receipt=kwargs.pop('receipt',self.receipt),
            receipt_signature_b64=kwargs.pop('receipt_signature_b64',self.sign()),
            expected=kwargs.pop('expected',self.expected))

    def deny(self,**kwargs):
        with self.assertRaises(ReceiptHold):
            self.call(**kwargs)

    def test_signed_consumption_is_evidence_only_and_no_execution(self):
        out=self.call()
        self.assertEqual(out['status'],'S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY')
        self.assertEqual(out['operator_signature'],'VALID_S0')
        self.assertEqual(out['witness_signature'],'VALID_S0')
        self.assertFalse(out['execution_allowed'])
        self.assertFalse(out['provider_dispatch_allowed'])
        self.assertFalse(out['production_authority'])
        self.assertEqual(out['operator_custody'],'NOT_PROVEN')
        self.assertEqual(out['independent_global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_local_double_consume_denied_by_test_reservation_backend(self):
        self.call()
        self.deny()
        self.assertEqual(self.backend.calls,2)

    def test_bad_operator_signature_prevents_reservation(self):
        self.deny(receipt_signature_b64=base64.b64encode(self.wrong.sign(canonical(self.receipt))).decode())
        self.assertEqual(self.backend.calls,0)

    def test_exact_request_binding_mismatch_prevents_reservation(self):
        self.deny(expected={**self.expected,'request_sha256':'f'*64})
        self.assertEqual(self.backend.calls,0)

    def test_signed_witness_uses_different_trust_root(self):
        with self.assertRaises(ReceiptHold):
            ReservationBoundary(receipt_verifier=self.verifier,witness_id='witness-a',
                witness_public_key=self.pub(self.operator),witness_epoch=2,
                reserve_once=self.backend.reserve_once,clock=lambda:112.0)

    def test_missing_reservation_backend_fails_closed(self):
        with self.assertRaises(ReceiptHold):
            ReservationBoundary(receipt_verifier=self.verifier,witness_id='witness-a',
                witness_public_key=self.pub(self.witness_key),witness_epoch=2,
                reserve_once=None,clock=lambda:112.0)

    def test_witness_key_substitution_rejected(self):
        self.backend.key=self.wrong
        self.deny()

    def test_witness_wrong_receipt_hash_rejected(self):
        self.backend.bad={'receipt_sha256':'f'*64}
        self.deny()

    def test_witness_wrong_operation_id_rejected(self):
        self.backend.bad={'operation_id':'other-op'}
        self.deny()

    def test_witness_wrong_nonce_rejected(self):
        self.backend.bad={'nonce':'f'*32}
        self.deny()

    def test_witness_wrong_key_epoch_rejected(self):
        self.backend.bad={'witness_epoch':1}
        self.deny()

    def test_witness_wrong_sequence_rejected(self):
        self.backend.bad={'receipt_sequence':20}
        self.deny()

    def test_witness_false_consumption_rejected(self):
        self.backend.bad={'status':'REJECTED'}
        self.deny()

    def test_witness_extra_field_rejected(self):
        self.backend.bad={'production_authority':True}
        self.deny()

    def test_witness_expired_at_response_time_denied(self):
        self.clock[0]=130.0
        self.deny()

    def test_transport_failure_is_hold_never_retry_or_implicit_fallback(self):
        self.backend.drop=True
        self.deny()
        self.assertEqual(self.backend.calls,1)

    def test_concurrent_same_receipt_only_one_contract_success(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            outcomes=list(executor.map(lambda _ : self._try(),range(8)))
        self.assertEqual(outcomes.count('S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY'),1)
        self.assertEqual(outcomes.count('HOLD'),7)

    def _try(self):
        try:return self.call()['status']
        except ReceiptHold:return 'HOLD'

    def test_total_local_backend_rollback_still_defeats_single_use(self):
        first=self.call()
        self.backend.consumed.clear()  # Deliberate counterexample, NOT a PASS antirollback gate.
        second=self.call()
        self.assertEqual(first['status'],second['status'])
        self.assertFalse(first['execution_allowed'])
        self.assertFalse(second['execution_allowed'])
        self.assertEqual(second['independent_global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

if __name__=='__main__':
    unittest.main()
