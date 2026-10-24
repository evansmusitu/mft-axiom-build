"""Custodian consent does not prove independently controlled signing-key custody."""
import base64
import copy
import hashlib
import json
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.custodian_enrollment_s0 import (CustodianEnrollmentS0, EnrollmentHold)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


class TestEnrollment(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.review = CustodianEnrollmentS0(
            public_key=self.public, custodian_ref='owner-custodian',
            verifier_ref='separate-verifier', policy_sha256='a' * 64, key_epoch=3,
        )
        self.challenge = self.review.prepare_local_challenge(issued_at_unix=1000, ttl_seconds=120)

    def proof(self, challenge=None, signer=None):
        challenge = self.challenge if challenge is None else challenge
        signer = self.key if signer is None else signer
        msg = b'AXIOM_ISO_S0_CUSTODIAN_POP_V1\0' + canonical(challenge)
        signature = base64.b64encode(signer.sign(msg)).decode('ascii')
        return {'schema': 'musitu.axiom.iso.s0.custodian-pop-proof.v1',
                'challenge_sha256': hashlib.sha256(canonical(challenge)).hexdigest(),
                'key_epoch': 3,
                'public_key_sha256': hashlib.sha256(self.public).hexdigest(),
                'signature_b64': signature}

    def verify(self, challenge=None, proof=None, now=1050, consumed_nonces=()):
        challenge = self.challenge if challenge is None else challenge
        proof = self.proof(challenge) if proof is None else proof
        return self.review.review(challenge=challenge, proof=proof,
                                  observed_at_unix=now, consumed_nonces=consumed_nonces)

    def test_signed_challenge_proves_only_local_possession(self):
        result = self.verify()
        self.assertEqual(result['status'], 'LOCAL_PUBLIC_KEY_POSSESSION_ONLY')
        self.assertEqual(result['custodian_authorization'], 'OWNER_DECISION_RECORDED_NOT_PROVISIONED')
        self.assertEqual(result['external_custody'], 'NOT_PROVEN')
        self.assertEqual(result['independent_verifier'], 'NOT_PROVEN')
        self.assertEqual(result['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')
        for flag in ('execution_allowed','provider_dispatch_allowed', 'production_authority',
                     'enrollment_activated', 'recovery_authorized', 'single_use_reservation_issued'):
            self.assertIs(result[flag], False)

    def test_challenge_has_strong_fresh_nonce(self):
        a = self.challenge['nonce_b64']; b = self.review.prepare_local_challenge(1000, 120)['nonce_b64']
        self.assertNotEqual(a, b)
        self.assertEqual(len(base64.b64decode(a)), 32)

    def test_wrong_signer_fails(self):
        with self.assertRaises(EnrollmentHold):
            self.verify(proof=self.proof(signer=Ed25519PrivateKey.generate()))

    def test_signature_over_modified_challenge_fails(self):
        altered = copy.deepcopy(self.challenge); altered['expires_at_unix'] = 1070
        with self.assertRaises(EnrollmentHold):
            self.verify(challenge=altered, proof=self.proof())

    def test_expired_challenge_fails(self):
        with self.assertRaises(EnrollmentHold): self.verify(now=1120)

    def test_challenge_not_yet_valid_fails(self):
        with self.assertRaises(EnrollmentHold): self.verify(now=999)

    def test_local_consumption_hint_rejects_replay(self):
        with self.assertRaises(EnrollmentHold):
            self.verify(consumed_nonces=(self.challenge['nonce_b64'],))

    def test_replaying_when_all_local_anchors_erased_remains_possible(self):
        one = self.verify(consumed_nonces=())
        two = self.verify(consumed_nonces=())
        self.assertEqual(one['status'], two['status'])
        self.assertEqual(two['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')

    def test_invalid_epoch_rejected(self):
        evidence = self.proof(); evidence['key_epoch'] = 4
        with self.assertRaises(EnrollmentHold): self.verify(proof=evidence)

    def test_changed_policy_rejected(self):
        altered = dict(self.challenge, policy_sha256='b'*64)
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_wrong_custodian_rejected(self):
        altered = dict(self.challenge, custodian_ref='other-owner')
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_wrong_verifier_rejected(self):
        altered = dict(self.challenge, verifier_ref='fake-verifier')
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_extra_fields_rejected(self):
        altered = dict(self.challenge, release_allowed=True)
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_unknown_proof_fields_rejected(self):
        proof = dict(self.proof(), production_authority=True)
        with self.assertRaises(EnrollmentHold): self.verify(proof=proof)

    def test_wrong_digest_rejected(self):
        proof = self.proof(); proof['challenge_sha256'] = '0' * 64
        with self.assertRaises(EnrollmentHold): self.verify(proof=proof)

    def test_malformed_base64_rejected(self):
        proof = self.proof(); proof['signature_b64'] = '!bad'
        with self.assertRaises(EnrollmentHold): self.verify(proof=proof)

    def test_boolean_timestamp_and_excessive_lifetime_rejected(self):
        altered = dict(self.challenge, issued_at_unix=True)
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)
        altered = dict(self.challenge, expires_at_unix=1401)
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_noncanonical_nonce_rejected(self):
        altered = dict(self.challenge, nonce_b64='-'*44)
        with self.assertRaises(EnrollmentHold): self.verify(challenge=altered)

    def test_consumed_nonces_wrong_type_fails(self):
        with self.assertRaises(EnrollmentHold): self.verify(consumed_nonces=None)

    def test_explicit_decision_never_becomes_execution_authority(self):
        self.assertIs(self.verify()['enrollment_activated'], False)
        self.assertEqual(self.verify()['external_revocation'], 'NOT_PROVEN')
        self.assertEqual(self.verify()['account_wide_hard_zero_cost'], 'NOT_PROVEN')


if __name__ == '__main__': unittest.main()
