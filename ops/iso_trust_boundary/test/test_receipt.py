"""Adversarial, synthetic-key tests. Neither issuer nor independent custody is real."""
import base64
import hashlib
import json
import math
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from ops.iso_trust_boundary.verify_operator_receipt import ReceiptVerifier, ReceiptHold

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()

class ReceiptValidationTests(unittest.TestCase):
    def setUp(self):
        self.key=Ed25519PrivateKey.generate()
        self.other=Ed25519PrivateKey.generate()
        public=self.key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.gate=ReceiptVerifier(pinned_operator_id='operator-a',pinned_public_key=public,
                                  pinned_policy_sha256='a'*64,pinned_key_epoch=7,clock=lambda:110.)
        self.expected={'operation_id':'op-123','project_id':'project-1','work_id':'work-1',
                       'workload_identity_id':'agent-work-1','request_sha256':'b'*64,
                       'nonce':'c'*32,'risk_class':'S3'}
        self.receipt={'schema':'musitu.axiom.iso.s0.receipt.v1',
                      'operator_id':'operator-a','key_epoch':7,'policy_sha256':'a'*64,
                      **self.expected,'decision':'ALLOW','sequence':19,
                      'issued_at_unix':100,'expires_at_unix':125}

    def signed(self,receipt=None,key=None):
        r=self.receipt if receipt is None else receipt
        k=self.key if key is None else key
        return base64.b64encode(k.sign(canonical(r))).decode('ascii')

    def call(self,receipt=None,key=None,expected=None,signature=None):
        r=self.receipt if receipt is None else receipt
        return self.gate.verify(receipt=r,signature_b64=signature if signature is not None else self.signed(r,key),
                                expected=self.expected if expected is None else expected)

    def denied(self,receipt=None,key=None,expected=None,signature=None):
        with self.assertRaises(ReceiptHold):
            self.call(receipt,key,expected,signature)

    def test_valid_signature_is_evidence_only_not_execution_authority(self):
        out=self.call()
        self.assertEqual(out['status'],'CRYPTOGRAPHIC_SIGNATURE_VALID_S0_ONLY')
        self.assertFalse(out['provider_dispatch_allowed'])
        self.assertFalse(out['production_authority'])
        self.assertFalse(out['execution_allowed'])
        self.assertEqual(out['operator_custody'],'NOT_PROVEN')
        self.assertEqual(out['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(out['receipt_sha256'],hashlib.sha256(canonical(self.receipt)).hexdigest())

    def test_key_substitution_denied(self):self.denied(key=self.other)
    def test_request_digest_binding_denied(self):self.denied(expected={**self.expected,'request_sha256':'d'*64})
    def test_workload_binding_denied(self):self.denied(expected={**self.expected,'workload_identity_id':'other'})
    def test_nonce_binding_denied(self):self.denied(expected={**self.expected,'nonce':'d'*32})
    def test_risk_downgrade_denied(self):self.denied(expected={**self.expected,'risk_class':'S4'})
    def test_signed_wrong_operator_denied(self):self.denied(receipt={**self.receipt,'operator_id':'operator-b'})
    def test_signed_wrong_policy_denied(self):self.denied(receipt={**self.receipt,'policy_sha256':'d'*64})
    def test_signed_old_epoch_denied(self):self.denied(receipt={**self.receipt,'key_epoch':6})
    def test_signed_deny_is_never_authorization(self):self.denied(receipt={**self.receipt,'decision':'DENY'})
    def test_extra_fields_denied(self):self.denied(receipt={**self.receipt,'release_authority':True})
    def test_missing_fields_denied(self):
        r=dict(self.receipt);r.pop('sequence');self.denied(receipt=r)
    def test_invalid_signature_encoding_denied(self):self.denied(signature='invalid%%')
    def test_expired_receipt_denied(self):self.denied(receipt={**self.receipt,'expires_at_unix':110})
    def test_not_yet_valid_receipt_denied(self):self.denied(receipt={**self.receipt,'issued_at_unix':115,'expires_at_unix':125})
    def test_overlong_validity_denied(self):self.denied(receipt={**self.receipt,'expires_at_unix':1000})
    def test_invalid_sequence_and_boolean_epoch_denied(self):
        self.denied(receipt={**self.receipt,'sequence':True})
        self.denied(receipt={**self.receipt,'key_epoch':True})
    def test_invalid_clock_denied(self):
        self.gate=ReceiptVerifier(pinned_operator_id='operator-a',pinned_public_key=self.gate.pinned_public_key,
                                  pinned_policy_sha256='a'*64,pinned_key_epoch=7,clock=lambda:math.nan)
        self.denied()
    def test_same_signed_receipt_replay_remains_unqualified_even_if_valid_twice(self):
        a=self.call();b=self.call()
        self.assertEqual(a['receipt_sha256'],b['receipt_sha256'])
        for row in (a,b):
            self.assertFalse(row['execution_allowed'])
            self.assertEqual(row['single_use_admission'],'NOT_PROVEN')

if __name__=='__main__':unittest.main()
