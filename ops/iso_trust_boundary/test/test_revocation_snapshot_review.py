"""Revocation freshness and destructive-loss negative tests; synthetic keys only."""
import base64
import copy
import json
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.revocation_snapshot_review import RevocationHold, RevocationSnapshotReview


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()


def public(key):
    return key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)

class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.revocation_key=Ed25519PrivateKey.generate()
        self.operator_key=Ed25519PrivateKey.generate()
        self.witness_key=Ed25519PrivateKey.generate()
        self.pins=dict(
            revocation_authority_id='operator-revocation-custodian',
            pinned_revocation_public_key=public(self.revocation_key),
            pinned_operator_public_key=public(self.operator_key),
            pinned_witness_public_key=public(self.witness_key),
            policy_sha256='c'*64,
            root_epoch=5,operator_id='operator:one',witness_id='witness:one',
            operator_epoch=9,witness_epoch=12,clock=lambda:1000,
        )
        self.reviewer=RevocationSnapshotReview(**self.pins)
        self.anchor={'revision':31,'digest':'a'*64}
        self.snapshot={
            'schema':'musitu.axiom.iso.s0.revocation-snapshot.v1',
            'revocation_authority_id':'operator-revocation-custodian',
            'root_epoch':5,'policy_sha256':'c'*64,
            'previous_revision':31,'previous_digest':'a'*64,'revision':32,
            'operator_id':'operator:one','witness_id':'witness:one',
            'operator_epoch':9,'witness_epoch':12,
            'revoked_operator_epochs':[3,6],
            'revoked_witness_epochs':[2,8],
            'issued_at_unix':999,'expires_at_unix':1020,
            'status':'EVIDENCE_ONLY_NOT_RELEASE',
        }

    def signed(self,snapshot=None):
        body = self.snapshot if snapshot is None else snapshot
        message=b'AXIOM_ISO_S0_REVOCATION_SNAPSHOT_V1\0'+canonical(body)
        return {'snapshot':body,'signature_b64':base64.b64encode(self.revocation_key.sign(message)).decode()}

    def judge(self,anchor=None, envelope=None):
        return self.reviewer.review(
            anchor=self.anchor if anchor is None else anchor,
            envelope=self.signed() if envelope is None else envelope)

    def test_valid_pinned_revocation_snapshot_is_evidence_only(self):
        result=self.judge()
        self.assertEqual(result['status'],'S0_SIGNED_REVOCATION_SNAPSHOT_REVIEWED')
        self.assertEqual(result['revocation_freshness'],'SYNTHETIC_ONLY_NOT_EXTERNAL')
        self.assertIs(result['execution_allowed'],False)
        self.assertIs(result['provider_dispatch_allowed'],False)
        self.assertIs(result['production_authority'],False)
        self.assertEqual(result['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_missing_external_anchor_blocks_all_recovery(self):
        with self.assertRaisesRegex(RevocationHold,'EXTERNAL_ANCHOR_MISSING'):
            self.reviewer.review(anchor=None,envelope=self.signed())

    def test_stale_anchor_or_fork_denied(self):
        for anchor in ({'revision':32,'digest':'a'*64},{'revision':31,'digest':'b'*64}):
            with self.subTest(anchor=anchor),self.assertRaisesRegex(RevocationHold,'ANCHOR_MISMATCH'):
                self.judge(anchor=anchor)

    def test_rolled_back_all_external_anchor_material_reaccepts_snapshot_negative(self):
        first=self.judge()
        restored_anchor=copy.deepcopy(self.anchor)
        second=self.judge(anchor=restored_anchor)
        self.assertEqual(first['snapshot_sha256'],second['snapshot_sha256'])
        self.assertEqual(first['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_revoked_operator_epoch_denied_even_with_real_signature(self):
        body=dict(self.snapshot,revoked_operator_epochs=[3,6,9]);envelope=self.signed(body)
        with self.assertRaisesRegex(RevocationHold,'ACTIVE_OPERATOR_REVOKED'):
            self.judge(envelope=envelope)

    def test_revoked_witness_epoch_denied(self):
        body=dict(self.snapshot,revoked_witness_epochs=[2,8,12]);envelope=self.signed(body)
        with self.assertRaisesRegex(RevocationHold,'ACTIVE_WITNESS_REVOKED'):
            self.judge(envelope=envelope)

    def test_expired_revocation_snapshot_denied(self):
        body=dict(self.snapshot,issued_at_unix=900,expires_at_unix=930)
        with self.assertRaisesRegex(RevocationHold,'EXPIRED'):
            self.judge(envelope=self.signed(body))

    def test_wrong_signed_policy_denied(self):
        body=dict(self.snapshot,policy_sha256='d'*64)
        with self.assertRaisesRegex(RevocationHold,'PINNED_IDENTITY'):self.judge(envelope=self.signed(body))

    def test_signature_tampered(self):
        envelope=self.signed();envelope['signature_b64']=base64.b64encode(self.operator_key.sign(b'wrong')).decode()
        with self.assertRaisesRegex(RevocationHold,'INVALID_SIGNATURE'):
            self.judge(envelope=envelope)

    def test_key_reuse_invalid(self):
        pins=dict(self.pins,pinned_revocation_public_key=public(self.operator_key))
        with self.assertRaisesRegex(RevocationHold,'KEY_REUSE'):
            RevocationSnapshotReview(**pins)

    def test_unsorted_duplicate_revocations_are_rejected(self):
        for revoked in ([6,3],[3,3],[-1],[True],[1.0]):
            with self.subTest(revoked=revoked),self.assertRaisesRegex(RevocationHold,'INVALID_REVOKED_EPOCHS'):
                self.judge(envelope=self.signed(dict(self.snapshot,revoked_operator_epochs=revoked)))

    def test_root_epoch_rollback_denied(self):
        body=dict(self.snapshot,root_epoch=3)
        with self.assertRaises(RevocationHold):self.judge(envelope=self.signed(body))

    def test_extra_field_cannot_override_revocation(self):
        body=dict(self.snapshot,ignore_revocation=True)
        with self.assertRaisesRegex(RevocationHold,'EXACT_SNAPSHOT_FIELDS'):
            self.judge(envelope=self.signed(body))

    def test_sequence_gap_blocks(self):
        body=dict(self.snapshot,revision=34)
        with self.assertRaisesRegex(RevocationHold,'REVISION_NONADJACENT'):
            self.judge(envelope=self.signed(body))

    def test_encoding_canonical_and_size_limited(self):
        envelope=self.signed();envelope['signature_b64']+='\n'
        with self.assertRaisesRegex(RevocationHold,'SIGNATURE_ENCODING'):
            self.judge(envelope=envelope)

    def test_same_identity_is_denied(self):
        pins=dict(self.pins,witness_id='operator:one')
        with self.assertRaisesRegex(RevocationHold,'IDENTITY_COLLISION'):
            RevocationSnapshotReview(**pins)

    def test_clock_unavailable_is_hold(self):
        pins=dict(self.pins,clock=lambda:float('nan'))
        re=RevocationSnapshotReview(**pins)
        with self.assertRaisesRegex(RevocationHold,'CLOCK_INVALID'):
            re.review(anchor=self.anchor,envelope=self.signed())

    def test_unsigned_caller_says_not_revoked_is_not_accepted(self):
        with self.assertRaises(RevocationHold):
            self.reviewer.review(anchor=self.anchor,envelope={'snapshot':self.snapshot,'signature_b64':None})

if __name__=='__main__': unittest.main()