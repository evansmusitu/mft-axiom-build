"""TDD: positive synthetic proofs NEVER become authorization; reject mixed trust roots.

These are local cryptographic fixture tests, not independent custody or release evidence.
"""
import base64
import hashlib
import unittest

from ops.iso_trust_boundary.checkpoint_protocol import ExternalCheckpointVerifier
from ops.iso_trust_boundary.preconsumption_evidence import (
    PreconsumptionHold, S0PreconsumptionReviewer)
from ops.iso_trust_boundary.test import test_nonrelease_cross_boundary as cross_fixtures

canonical=cross_fixtures.canonical
public=cross_fixtures.public


class S0PreconsumptionContractTests(unittest.TestCase):
    def setUp(self):
        self.lab=cross_fixtures.CrossBoundaryNonReleaseTests('test_signed_receipt_and_sqlite_consumption_not_permission_to_s3_or_spend')
        self.lab.setUp()
        self.addCleanup(self.lab.doCleanups)
        self.lab.op_expected['risk_class']='S0'
        self.lab.receipt['risk_class']='S0'
        self.lab.operation['risk_class']='S0'
        self.anchor={'sequence':40,'digest':'e'*64}
        digest=hashlib.sha256(canonical(self.lab.receipt)).hexdigest()
        self.checkpoint_body={
            'schema':'musitu.axiom.iso.s0.external-checkpoint.v1',
            'operator_id':'operator-lab','witness_id':'witness-lab','operator_epoch':1,
            'witness_epoch':2,'policy_sha256':'a'*64,
            'operation_id':self.lab.receipt['operation_id'],'receipt_sha256':digest,
            'previous_sequence':40,'previous_digest':'e'*64,'next_sequence':41,
            'issued_at_unix':205,'expires_at_unix':225,
            'decision':'EVIDENCE_ONLY_NOT_RELEASE'
        }
        self.checkpoint=ExternalCheckpointVerifier(
            operator_id='operator-lab',operator_public_key=public(self.lab.operator),
            witness_id='witness-lab',witness_public_key=public(self.lab.witness),
            policy_sha256='a'*64,operator_epoch=1,witness_epoch=2,
            clock=lambda:210,revoked_operator_epochs=())
        self.reviewer=S0PreconsumptionReviewer(
            receipt_verifier=self.lab.verifier,
            revocation_verifier=self.lab.revocation,
            checkpoint_verifier=self.checkpoint,
            financial_reviewer=self.lab.guard)

    def sig_receipt(self):
        return base64.b64encode(self.lab.operator.sign(canonical(self.lab.receipt))).decode()

    def checkpoint_envelope(self):
        raw=b'AXIOM_ISO_S0_EXTERNAL_CHECKPOINT_V1\0'+canonical(self.checkpoint_body)
        return {'checkpoint':self.checkpoint_body,
                'operator_signature_b64':base64.b64encode(self.lab.operator.sign(raw)).decode(),
                'witness_signature_b64':base64.b64encode(self.lab.witness.sign(raw)).decode()}

    def inputs(self):
        return dict(
            operation=self.lab.operation, financial=self.lab.financial,
            expected=self.lab.op_expected, expected_agent_id=self.lab.operation['agent_id'], receipt=self.lab.receipt,
            receipt_signature_b64=self.sig_receipt(),
            revocation_anchor={'revision':2,'digest':'d'*64},
            revocation_envelope=self.lab.signed_revocation(),
            checkpoint_anchor=self.anchor,checkpoint_envelope=self.checkpoint_envelope())

    def test_genuine_local_synthetic_signatures_remain_evidence_only(self):
        result=self.reviewer.review(**self.inputs())
        self.assertEqual(result['status'],'S0_PRECONSUMPTION_EVIDENCE_RECONCILED_NOT_ADMITTED')
        self.assertEqual(result['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(result['external_provider_budget'],'NOT_PROVEN')
        self.assertEqual(result['next_sequence'],41)
        for field in ('execution_allowed','reservation_issued','recovery_authorized',
                      'provider_dispatch_allowed','production_authority'):
            self.assertIs(result[field],False)

    def test_operation_identity_mismatch_is_denied(self):
        p=self.inputs();p['operation']=dict(p['operation'],agent_id='different-agent')
        with self.assertRaisesRegex(PreconsumptionHold,'OPERATION_ACTOR_MISMATCH'):
            self.reviewer.review(**p)

    def test_operation_request_digest_mismatch_is_denied(self):
        p=self.inputs();p['operation']=dict(p['operation'],request_sha256='f'*64)
        with self.assertRaisesRegex(PreconsumptionHold,'OPERATION_BINDING_MISMATCH'):
            self.reviewer.review(**p)

    def test_missing_current_revocation_anchor_fails_closed(self):
        p=self.inputs();p['revocation_anchor']=None
        with self.assertRaisesRegex(PreconsumptionHold,'REVOCATION_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_missing_checkpoint_anchor_fails_closed(self):
        p=self.inputs();p['checkpoint_anchor']=None
        with self.assertRaisesRegex(PreconsumptionHold,'CHECKPOINT_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_checkpoint_receipt_mismatch_is_denied(self):
        p=self.inputs();self.checkpoint_body['receipt_sha256']='f'*64
        p['checkpoint_envelope']=self.checkpoint_envelope()
        with self.assertRaisesRegex(PreconsumptionHold,'CHECKPOINT_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_receipt_bad_signature_fails_closed(self):
        p=self.inputs();p['receipt_signature_b64']=p['checkpoint_envelope']['witness_signature_b64']
        with self.assertRaisesRegex(PreconsumptionHold,'RECEIPT_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_s3_request_is_rejected_even_with_signed_evidence(self):
        p=self.inputs();p['operation']=dict(p['operation'],risk_class='S3')
        with self.assertRaisesRegex(PreconsumptionHold,'NON_S0'):
            self.reviewer.review(**p)

    def test_free_tier_provider_claim_is_rejected(self):
        p=self.inputs();p['financial']=dict(p['financial'],external_provider_account_id='free-tier')
        with self.assertRaisesRegex(PreconsumptionHold,'FINANCIAL_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_tampered_revocation_is_denied(self):
        p=self.inputs();p['revocation_envelope']['snapshot']=dict(p['revocation_envelope']['snapshot'],root_epoch=4)
        with self.assertRaisesRegex(PreconsumptionHold,'REVOCATION_UNVERIFIED'):
            self.reviewer.review(**p)

    def test_cross_pinned_operator_receipt_must_match_revocation(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from ops.iso_trust_boundary.revocation_snapshot_review import RevocationSnapshotReview
        impostor=Ed25519PrivateKey.generate()
        unrelated=RevocationSnapshotReview(
            revocation_authority_id='separate-revoker',
            pinned_revocation_public_key=public(self.lab.revoker),
            pinned_operator_public_key=public(impostor),
            pinned_witness_public_key=public(self.lab.witness),
            policy_sha256='a'*64,root_epoch=3,operator_id='operator-lab',
            witness_id='witness-lab',operator_epoch=1,witness_epoch=2,
            clock=lambda:210)
        with self.assertRaisesRegex(PreconsumptionHold,'PINNED_SIGNER_MISMATCH'):
            S0PreconsumptionReviewer(receipt_verifier=self.lab.verifier,
                revocation_verifier=unrelated,checkpoint_verifier=self.checkpoint,
                financial_reviewer=self.lab.guard)

    def test_revocation_witness_key_must_match_checkpoint(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from ops.iso_trust_boundary.revocation_snapshot_review import RevocationSnapshotReview
        impostor=Ed25519PrivateKey.generate()
        unrelated=RevocationSnapshotReview(
            revocation_authority_id='separate-revoker',
            pinned_revocation_public_key=public(self.lab.revoker),
            pinned_operator_public_key=public(self.lab.operator),
            pinned_witness_public_key=public(impostor),
            policy_sha256='a'*64,root_epoch=3,operator_id='operator-lab',
            witness_id='witness-lab',operator_epoch=1,witness_epoch=2,clock=lambda:210)
        with self.assertRaisesRegex(PreconsumptionHold,'PINNED_SIGNER_MISMATCH'):
            S0PreconsumptionReviewer(receipt_verifier=self.lab.verifier,
                revocation_verifier=unrelated,checkpoint_verifier=self.checkpoint,
                financial_reviewer=self.lab.guard)

    def test_duplicate_reconciled_evidence_not_single_use(self):
        p=self.inputs();a=self.reviewer.review(**p);b=self.reviewer.review(**p)
        self.assertEqual(a['receipt_sha256'],b['receipt_sha256'])
        self.assertIs(b['reservation_issued'],False)
        self.assertEqual(b['single_use_admission'],'NOT_PROVEN')

    def test_output_never_lists_any_other_product_as_certified(self):
        result=self.reviewer.review(**self.inputs())
        self.assertEqual(result['product_objects'],['Project','Work','Agent','Artifact','Evidence'])
        self.assertEqual(result['security_qualification'],'NOT_CERTIFIED')

if __name__=='__main__': unittest.main()
