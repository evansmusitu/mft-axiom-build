"""Adversarial S0-only contract tests. Synthetic keys are never provider authority."""
import base64
import copy
import hashlib
import json
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.checkpoint_protocol import ExternalCheckpointVerifier, CheckpointHold


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def pub(private):
    return private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.operator = Ed25519PrivateKey.generate()
        self.witness = Ed25519PrivateKey.generate()
        self.pins = dict(operator_id='separate-operator', operator_public_key=pub(self.operator),
                         witness_id='external-ledger', witness_public_key=pub(self.witness),
                         policy_sha256='a'*64, operator_epoch=2, witness_epoch=5,
                         clock=lambda: 1000, revoked_operator_epochs=())
        self.verifier = ExternalCheckpointVerifier(**self.pins)
        self.anchor = {'sequence': 39, 'digest': 'b'*64}
        self.proposal = {
            'schema':'musitu.axiom.iso.s0.external-checkpoint.v1',
            'operator_id':'separate-operator', 'witness_id':'external-ledger',
            'operator_epoch':2,'witness_epoch':5,'policy_sha256':'a'*64,
            'operation_id':'work:integration-42','receipt_sha256':'c'*64,
            'previous_sequence':39, 'previous_digest':'b'*64,'next_sequence':40,
            'issued_at_unix':999,'expires_at_unix':1029,
            'decision':'EVIDENCE_ONLY_NOT_RELEASE'
        }

    def signed(self, proposal=None):
        item = self.proposal if proposal is None else proposal
        raw = b'AXIOM_ISO_S0_EXTERNAL_CHECKPOINT_V1\0' + encode(item)
        return {'checkpoint':item,
                'operator_signature_b64':base64.b64encode(self.operator.sign(raw)).decode(),
                'witness_signature_b64':base64.b64encode(self.witness.sign(raw)).decode()}

    def verify(self, anchor=None, envelope=None, **kwargs):
        return self.verifier.review(anchor=self.anchor if anchor is None else anchor,
            envelope=self.signed() if envelope is None else envelope,
            expected={'operation_id':'work:integration-42','receipt_sha256':'c'*64},**kwargs)

    def test_valid_synthetic_signatures_yield_evidence_not_authorization(self):
        result = self.verify()
        self.assertEqual(result['status'], 'SIGNED_CHECKPOINT_CONTINUITY_S0_ONLY')
        self.assertEqual(result['next_sequence'], 40)
        self.assertEqual(result['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(result['external_operator_custody'], 'NOT_PROVEN')
        self.assertEqual(result['independent_verifier'], 'NOT_PROVEN')
        for field in ('execution_allowed','provider_dispatch_allowed','recovery_authorized','production_authority'):
            self.assertIs(result[field],False)

    def test_total_anchor_loss_blocks_signed_recovery(self):
        with self.assertRaisesRegex(CheckpointHold,'ANCHOR_UNAVAILABLE'):
            self.verifier.review(anchor=None,envelope=self.signed(),
                expected={'operation_id':'work:integration-42','receipt_sha256':'c'*64})

    def test_rollback_old_signed_checkpoint_against_high_water_fails(self):
        with self.assertRaisesRegex(CheckpointHold,'STALE_OR_FORKED_ANCHOR'):
            self.verify(anchor={'sequence':42,'digest':'d'*64})

    def test_same_signed_step_can_be_replayed_if_all_anchors_are_rolled_back(self):
        # Honest negative: complete state rollback defeats this S0 validator.
        first=self.verify()
        second=self.verify(anchor=copy.deepcopy(self.anchor),envelope=self.signed())
        self.assertEqual(first['checkpoint_sha256'],second['checkpoint_sha256'])
        self.assertEqual(second['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_bad_witness_signature_denied(self):
        envelope=self.signed(); envelope['witness_signature_b64']=envelope['operator_signature_b64']
        with self.assertRaisesRegex(CheckpointHold,'WITNESS_SIGNATURE_INVALID'):
            self.verify(envelope=envelope)

    def test_tampered_operation_rejected_even_if_envelope_signatures_remain(self):
        envelope=self.signed(); envelope['checkpoint']=dict(self.proposal,operation_id='rogue-operation')
        with self.assertRaises(CheckpointHold): self.verify(envelope=envelope)

    def test_witness_key_reuse_is_denied(self):
        pins=dict(self.pins,witness_public_key=pub(self.operator))
        with self.assertRaisesRegex(CheckpointHold,'KEY_REUSE'):ExternalCheckpointVerifier(**pins)

    def test_revoked_epoch_denied_even_for_authentic_signature(self):
        pins=dict(self.pins,revoked_operator_epochs=(2,))
        with self.assertRaisesRegex(CheckpointHold,'REVOKED'):ExternalCheckpointVerifier(**pins)

    def test_sequence_gap_is_denied_even_when_dual_signed(self):
        modified=dict(self.proposal,next_sequence=42)
        with self.assertRaisesRegex(CheckpointHold,'NONADJACENT_SEQUENCE'):
            self.verify(envelope=self.signed(modified))

    def test_missing_and_extra_fields_denied(self):
        modified=dict(self.proposal,allow_s3=True)
        with self.assertRaisesRegex(CheckpointHold,'EXACT_CHECKPOINT_FIELDS'):
            self.verify(envelope=self.signed(modified))

    def test_expired_checkpoint_denied(self):
        modified=dict(self.proposal,issued_at_unix=900,expires_at_unix=930)
        with self.assertRaisesRegex(CheckpointHold,'EXPIRED'):
            self.verify(envelope=self.signed(modified))

    def test_noncanonical_signature_denied(self):
        envelope=self.signed();envelope['operator_signature_b64']+=' '
        with self.assertRaisesRegex(CheckpointHold,'SIGNATURE_ENCODING'):
            self.verify(envelope=envelope)

    def test_boolean_sequence_is_denied(self):
        modified=dict(self.proposal,next_sequence=True)
        with self.assertRaisesRegex(CheckpointHold,'NONADJACENT_SEQUENCE'):
            self.verify(envelope=self.signed(modified))

    def test_distinct_operator_witness_identities_required(self):
        pins=dict(self.pins,witness_id='separate-operator')
        with self.assertRaisesRegex(CheckpointHold,'IDENTITY_REUSE'):ExternalCheckpointVerifier(**pins)

    def test_signed_high_water_recovery_is_not_implicitly_trusted(self):
        # Arbitrary caller-supplied anchor cannot be source-authenticated here.
        result=self.verify()
        self.assertEqual(result['anchor_independence'],'NOT_PROVEN')
        self.assertIs(result['recovery_authorized'],False)

if __name__=='__main__':unittest.main()
