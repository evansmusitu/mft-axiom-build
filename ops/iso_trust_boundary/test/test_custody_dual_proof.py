"""Adversarial dual-role S0 proof contract: keys possession != real independence."""
import copy
import hashlib
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ops.iso_trust_boundary.custodian_enrollment import (
    make_challenge, challenge_signing_bytes, CustodianEnrollmentHold,
)
from ops.iso_trust_boundary.custody_dual_proof import (
    DualProofHold, inspect_dual_proof, witness_signing_bytes,
)


class DualProofTest(unittest.TestCase):
    def setUp(self):
        self.operator=Ed25519PrivateKey.generate()
        self.witness=Ed25519PrivateKey.generate()
        self.alternate=Ed25519PrivateKey.generate()
        self.keys=lambda k:k.public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw).hex()
        self.policy='a'*64
        self.challenge=make_challenge(
            project_id='musitu-axiom',custodian_id='owner-custodian-001',
            operator_public_key_hex=self.keys(self.operator),
            witness_public_key_hex=self.keys(self.witness),
            policy_sha256=self.policy,now=1000,ttl_seconds=300)
        signed=challenge_signing_bytes(self.challenge)
        self.op_proof={
            'schema':'musitu.axiom.custody-possession-proof.v1',
            'challenge_sha256':hashlib.sha256(signed).hexdigest(),
            'operator_signature_hex':self.operator.sign(signed).hex()}
        witness_message=witness_signing_bytes(self.challenge,self.op_proof,'reviewer-001')
        self.witness_proof={
            'schema':'musitu.axiom.custody-witness-proof.v1',
            'challenge_sha256':hashlib.sha256(signed).hexdigest(),
            'operator_signature_sha256':hashlib.sha256(bytes.fromhex(self.op_proof['operator_signature_hex'])).hexdigest(),
            'witness_id':'reviewer-001',
            'witness_signature_hex':self.witness.sign(witness_message).hex()}
        self.kw={
            'project_id':'musitu-axiom','custodian_id':'owner-custodian-001',
            'witness_id':'reviewer-001','policy_sha256':self.policy,
            'operator_public_key_hex':self.keys(self.operator),
            'witness_public_key_hex':self.keys(self.witness),'now':1001}

    def inspect(self,**changes):
        opts=dict(challenge=self.challenge,operator_proof=self.op_proof,
                  witness_proof=self.witness_proof,**self.kw)
        opts.update(changes)
        return inspect_dual_proof(**opts)

    def test_valid_dual_possession_is_explicitly_never_authority(self):
        r=self.inspect()
        self.assertEqual(r['status'],'LOCAL_DUAL_KEY_POSSESSION_VALID_ONLY')
        self.assertEqual(r['independent_custody'],'NOT_PROVEN')
        self.assertEqual(r['independent_verifier'],'NOT_PROVEN')
        self.assertEqual(r['single_use_admission'],'NOT_PROVEN')
        self.assertEqual(r['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
        for key in ('execution_allowed','provider_dispatch_allowed',
                    'recovery_authorized','reservation_issued','production_authority'):
            self.assertIs(r[key],False)

    def test_valid_replay_twice_is_not_misclassified_as_single_use(self):
        self.assertEqual(self.inspect(),self.inspect())
        self.assertEqual(self.inspect()['single_use_admission'],'NOT_PROVEN')

    def test_wrong_witness_private_key_signature_rejected(self):
        bad=dict(self.witness_proof,witness_signature_hex=self.alternate.sign(
            witness_signing_bytes(self.challenge,self.op_proof,'reviewer-001')).hex())
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=bad)

    def test_operator_signature_cannot_replace_witness_signature(self):
        msg=witness_signing_bytes(self.challenge,self.op_proof,'reviewer-001')
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,witness_signature_hex=self.operator.sign(msg).hex()))

    def test_altered_witness_identity_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_id='reviewer-002')

    def test_custodian_cannot_be_its_own_witness(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_id='owner-custodian-001')

    def test_policy_mismatch_rejected(self):
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(policy_sha256='b'*64)

    def test_challenge_nonce_mutation_rejected(self):
        ch=dict(self.challenge,nonce='f'*64)
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(challenge=ch)

    def test_challenge_expired_rejected(self):
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(now=1300)

    def test_future_issued_challenge_rejected(self):
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(now=999)

    def test_witness_proof_missing_field_rejected(self):
        bad={k:v for k,v in self.witness_proof.items() if k!='witness_id'}
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=bad)

    def test_witness_proof_extra_authority_flag_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,production_authority=True))

    def test_wrong_challenge_digest_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,challenge_sha256='0'*64))

    def test_wrong_operator_signature_digest_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,operator_signature_sha256='0'*64))

    def test_wrong_witness_schema_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,schema='musitu.axiom.custody-admin-grant.v1'))

    def test_signature_nonlowercase_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=dict(
            self.witness_proof,witness_signature_hex='A'*128))

    def test_witness_public_pin_substitution_rejected(self):
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(witness_public_key_hex=self.keys(self.alternate))

    def test_operator_proof_invalid_signer_rejected(self):
        op=dict(self.op_proof,operator_signature_hex=self.alternate.sign(
            challenge_signing_bytes(self.challenge)).hex())
        with self.assertRaises((DualProofHold,CustodianEnrollmentHold)):
            self.inspect(operator_proof=op)

    def test_witness_proof_non_mapping_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_proof=[])

    def test_witness_id_invalid_format_rejected(self):
        with self.assertRaises(DualProofHold):self.inspect(witness_id='../reviewer')

    def test_witness_signature_has_distinct_domain_and_bound_operator(self):
        m=witness_signing_bytes(self.challenge,self.op_proof,'reviewer-001')
        self.assertTrue(m.startswith(b'MUSITU-AXIOM-S0-WITNESS-POSSESSION-V1\x00'))
        self.assertNotEqual(m,challenge_signing_bytes(self.challenge))
        altered=dict(self.op_proof,operator_signature_hex='0'*128)
        with self.assertRaises((CustodianEnrollmentHold,DualProofHold)):
            witness_signing_bytes(self.challenge,altered,'reviewer-001')

    def test_same_public_key_roles_fail_closed(self):
        ch=dict(self.challenge,witness_public_key_hex=self.keys(self.operator))
        with self.assertRaises((CustodianEnrollmentHold,DualProofHold)):
            self.inspect(challenge=ch)


if __name__=='__main__':unittest.main()
