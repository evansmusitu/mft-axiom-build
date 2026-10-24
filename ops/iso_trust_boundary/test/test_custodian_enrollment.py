"""Custodian user-approval to cryptographic possession, never independent release."""
import copy
import hashlib
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from ops.iso_trust_boundary.custodian_enrollment import (
    CustodianEnrollmentHold,
    make_challenge,
    challenge_signing_bytes,
    inspect_key_possession,
    qualification_report,
)


class CustodianEnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.operator = Ed25519PrivateKey.generate()
        self.witness = Ed25519PrivateKey.generate()
        self.operator_pin = self.operator.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        self.witness_pin = self.witness.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        self.policy = 'a' * 64
        self.args = dict(
            project_id='musitu-axiom',
            custodian_id='human-owner-001',
            operator_public_key_hex=self.operator_pin,
            witness_public_key_hex=self.witness_pin,
            policy_sha256=self.policy,
            now=1792848000,
        )
        with patch('ops.iso_trust_boundary.custodian_enrollment.secrets.token_hex', return_value='9' * 64):
            self.challenge = make_challenge(**self.args)
        self.proof = {
            'schema': 'musitu.axiom.custody-possession-proof.v1',
            'challenge_sha256': hashlib.sha256(challenge_signing_bytes(self.challenge)).hexdigest(),
            'operator_signature_hex': self.operator.sign(challenge_signing_bytes(self.challenge)).hex(),
        }

    def inspect(self, challenge=None, proof=None, **overrides):
        kw=dict(project_id=self.args['project_id'],custodian_id=self.args['custodian_id'],
                policy_sha256=self.policy,operator_public_key_hex=self.operator_pin,
                witness_public_key_hex=self.witness_pin,now=self.args['now'] + 25)
        kw.update(overrides)
        return inspect_key_possession(challenge or self.challenge,proof or self.proof,**kw)

    def test_valid_signature_is_only_possession_not_independent_identity_or_release(self):
        r=self.inspect()
        self.assertEqual(r['status'],'LOCAL_KEY_POSSESSION_VALID_ONLY')
        self.assertEqual(r['signature_valid'],True)
        self.assertEqual(r['independent_custody'],'NOT_PROVEN')
        self.assertEqual(r['operator_identity'],'NOT_PROVEN')
        self.assertEqual(r['trusted_clock'],'NOT_PROVEN')
        self.assertEqual(r['external_monotonicity'],'NOT_PROVEN')
        self.assertEqual(r['external_revocation'],'NOT_PROVEN')
        self.assertEqual(r['independent_verifier'],'NOT_PROVEN')
        self.assertEqual(r['account_wide_zero_spend'],'NOT_PROVEN')
        for name in ['execution_allowed','provider_dispatch_allowed','reservation_issued','recovery_authorized','production_authority']:
            self.assertIs(r[name],False)

    def test_caller_says_verified_is_not_authority(self):
        r=self.inspect()
        for assertion in ({'independent':True},{'release_approved':True},
                         {'signed_by_operator':True,'witness':True},{'verified_by_ChatGPT':True},None):
            summary=qualification_report(r,assertion)
            self.assertEqual(summary['status'],'BLOCKED_EXTERNAL_AUTHORITY_NOT_PROVEN')
            self.assertIs(summary['execution_allowed'],False)
            self.assertIs(summary['production_authority'],False)
            self.assertIn('independent_separate_tenant',summary['missing'])
            self.assertIn('destructive_rollback_denied',summary['missing'])

    def test_expired_challenge_rejected(self):
        with self.assertRaisesRegex(CustodianEnrollmentHold,'EXPIRED'):
            self.inspect(now=self.args['now']+301)

    def test_future_challenge_rejected(self):
        with self.assertRaisesRegex(CustodianEnrollmentHold,'FUTURE'):
            self.inspect(now=self.args['now']-1)

    def test_distinct_key_enforcement(self):
        args=dict(self.args,witness_public_key_hex=self.operator_pin)
        with self.assertRaisesRegex(CustodianEnrollmentHold,'KEY_SEPARATION'):
            make_challenge(**args)

    def test_short_or_broken_public_keys_rejected(self):
        for value in ('aa','Z'*64,None,0,True,'b'*63):
            with self.subTest(value=value), self.assertRaises(CustodianEnrollmentHold):
                make_challenge(**dict(self.args,operator_public_key_hex=value))

    def test_policy_mismatch_rejected(self):
        with self.assertRaisesRegex(CustodianEnrollmentHold,'POLICY'):
            self.inspect(policy_sha256='b'*64)

    def test_operator_identity_mismatch_rejected(self):
        with self.assertRaisesRegex(CustodianEnrollmentHold,'CUSTODIAN'):
            self.inspect(custodian_id='somebody-else')

    def test_witness_key_mismatch_rejected(self):
        another=Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        with self.assertRaisesRegex(CustodianEnrollmentHold,'WITNESS'):
            self.inspect(witness_public_key_hex=another)

    def test_invalid_signature_rejected(self):
        proof=dict(self.proof,operator_signature_hex='00'*64)
        with self.assertRaisesRegex(CustodianEnrollmentHold,'SIGNATURE'):
            self.inspect(proof=proof)

    def test_signature_by_witness_not_operator_rejected(self):
        proof=dict(self.proof,operator_signature_hex=self.witness.sign(challenge_signing_bytes(self.challenge)).hex())
        with self.assertRaisesRegex(CustodianEnrollmentHold,'SIGNATURE'):
            self.inspect(proof=proof)

    def test_forged_nonce_rejected(self):
        forged=dict(self.challenge,nonce='8'*64)
        with self.assertRaisesRegex(CustodianEnrollmentHold,'CHALLENGE_DIGEST'):
            self.inspect(challenge=forged)

    def test_extra_fields_rejected(self):
        for field in ('approval','production_authority','independent_operator'):
            with self.subTest(field=field), self.assertRaisesRegex(CustodianEnrollmentHold,'FIELDS'):
                self.inspect(proof={**self.proof,field:True})

    def test_bad_challenge_schema_rejected(self):
        with self.assertRaisesRegex(CustodianEnrollmentHold,'SCHEMA'):
            self.inspect(challenge={**self.challenge,'schema':'magic-admin-bypass'})

    def test_invalid_timestamp_or_ttl_rejected(self):
        for value in (float('nan'),True,'1792848000',-1):
            with self.subTest(value=value),self.assertRaises(CustodianEnrollmentHold):
                make_challenge(**dict(self.args,now=value))
        with self.assertRaisesRegex(CustodianEnrollmentHold,'TTL'):
            make_challenge(**dict(self.args,ttl_seconds=601))

    def test_replayed_signature_may_validate_but_never_provides_single_use_admission(self):
        a=self.inspect()
        b=self.inspect()
        self.assertEqual(a,b)
        self.assertIs(a['reservation_issued'],False)
        self.assertEqual(a['single_use_admission'],'NOT_PROVEN')

    def test_user_appointment_is_not_external_identity_verification(self):
        r=self.inspect()
        self.assertEqual(r['custodian_appointment'],'USER_AUTHORIZED_NOT_PROVIDER_VERIFIED')
        self.assertEqual(r['risk_ceiling'],'S0_LOCAL_EVIDENCE_ONLY')


if __name__=='__main__':
    unittest.main()
