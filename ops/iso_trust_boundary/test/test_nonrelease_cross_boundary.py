"""S0 nonrelease integration across real local SQLite, signed proofs and budget.

Not a live provider, external witness, or independent verifier qualification.
"""
import base64
import json
from pathlib import Path
import tempfile
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from ops.iso_trust_boundary.verify_operator_receipt import ReceiptVerifier
from ops.iso_trust_boundary.reservation_boundary import ReservationBoundary
from ops.iso_trust_boundary.operator_lab_witness import bootstrap_local_witness, LocalWitnessLab
from ops.iso_trust_boundary.financial_zero_boundary import FinancialZeroBoundary, FinancialHold
from ops.iso_trust_boundary.revocation_snapshot_review import RevocationHold, RevocationSnapshotReview


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def public(key):
    return key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)


class CrossBoundaryNonReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        directory=Path(self.temp.name)
        directory.chmod(0o700)
        self.db=str(directory/'local-operator.sqlite3')
        self.operator=Ed25519PrivateKey.generate()
        self.witness=Ed25519PrivateKey.generate()
        self.revoker=Ed25519PrivateKey.generate()
        self.op_expected={
            'operation_id':'axiom:job:88','project_id':'axiom:project:88',
            'work_id':'axiom:work:88','workload_identity_id':'axiom:agent:88',
            'request_sha256':'b'*64,'nonce':'c'*32,'risk_class':'S3',
        }
        self.receipt={
            'schema':'musitu.axiom.iso.s0.receipt.v1','operator_id':'operator-lab',
            'key_epoch':1,'policy_sha256':'a'*64,**self.op_expected,
            'decision':'ALLOW','sequence':1,'issued_at_unix':200,
            'expires_at_unix':230,
        }
        bootstrap_local_witness(self.db,witness_id='witness-lab',epoch=2,
            signing_key=self.witness,acknowledged_lab_only=True)
        self.verifier=ReceiptVerifier(pinned_operator_id='operator-lab',
            pinned_public_key=public(self.operator),pinned_policy_sha256='a'*64,
            pinned_key_epoch=1,clock=lambda:210)
        self.guard=FinancialZeroBoundary(pinned_policy_sha256='a'*64,
            local_tool_allowlist=('sha256.compute',))
        self.operation={
            'schema':'musitu.axiom.iso.s0.planned-operation.v1',
            'policy_sha256':'a'*64,
            'operation_id':self.op_expected['operation_id'],
            'project_id':self.op_expected['project_id'],
            'work_id':self.op_expected['work_id'],'agent_id':'axiom:agent:88',
            'workload_identity_id':'axiom:agent:88',
            'request_sha256':self.op_expected['request_sha256'],
            'risk_class':'S3','tool_id':'sha256.compute','provider_dispatch':False,
            'network_egress':False,'external_state_write':False,
            'privileged_credential_required':False,
        }
        self.financial={
            'schema':'musitu.axiom.iso.s0.financial-input.v1','currency':'USD',
            'cost_source':'NO_EXTERNAL_PROVIDER_INVOCATION',
            'quoted_max_charge_micro_usd':0,'observed_charge_micro_usd':0,
            'external_provider_account_id':None,
            'external_provider_hard_zero_cap_verified':False,
            'billing_method_enabled':False,'billing_credits_available':False,
            'cost_unknown':False,
        }
        self.revocation=RevocationSnapshotReview(
            revocation_authority_id='separate-revoker',
            pinned_revocation_public_key=public(self.revoker),
            pinned_operator_public_key=public(self.operator),
            pinned_witness_public_key=public(self.witness),
            policy_sha256='a'*64,root_epoch=3,
            operator_id='operator-lab',witness_id='witness-lab',
            operator_epoch=1,witness_epoch=2,clock=lambda:210)
        self.revocation_body={
            'schema':'musitu.axiom.iso.s0.revocation-snapshot.v1',
            'revocation_authority_id':'separate-revoker',
            'root_epoch':3,'policy_sha256':'a'*64,'previous_revision':2,
            'previous_digest':'d'*64,'revision':3,'operator_id':'operator-lab',
            'witness_id':'witness-lab','operator_epoch':1,'witness_epoch':2,
            'revoked_operator_epochs':[],'revoked_witness_epochs':[],
            'issued_at_unix':205,'expires_at_unix':230,
            'status':'EVIDENCE_ONLY_NOT_RELEASE',
        }

    def consume_lab(self):
        boundary=ReservationBoundary(
            receipt_verifier=self.verifier,witness_id='witness-lab',
            witness_public_key=public(self.witness),witness_epoch=2,
            reserve_once=LocalWitnessLab(self.db,witness_id='witness-lab',
                epoch=2,signing_key=self.witness,clock=lambda:210).reserve_once,
            clock=lambda:210)
        return boundary.probe(
            receipt=self.receipt,
            receipt_signature_b64=base64.b64encode(self.operator.sign(canonical(self.receipt))).decode(),
            expected=self.op_expected)

    def signed_revocation(self):
        wire=b'AXIOM_ISO_S0_REVOCATION_SNAPSHOT_V1\0'+canonical(self.revocation_body)
        return {'snapshot':self.revocation_body,
            'signature_b64':base64.b64encode(self.revoker.sign(wire)).decode()}

    def test_signed_receipt_and_sqlite_consumption_not_permission_to_s3_or_spend(self):
        consumed=self.consume_lab()
        self.assertEqual(consumed['status'],'S0_SIGNED_RESERVATION_EVIDENCE_NOT_AUTHORITY')
        with self.assertRaisesRegex(FinancialHold,'NON_S0_OPERATION'):
            self.guard.review(operation=self.operation,financial=self.financial)
        self.assertIs(consumed['production_authority'],False)
        self.assertEqual(consumed['independent_global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')

    def test_revocation_evidence_also_cannot_issue_external_authority(self):
        receipt=self.consume_lab()
        rev=self.revocation.review(anchor={'revision':2,'digest':'d'*64},
            envelope=self.signed_revocation())
        self.assertFalse(receipt['execution_allowed'])
        self.assertFalse(rev['execution_allowed'])
        self.assertEqual(rev['independent_anchor_persistence'],'NOT_PROVEN')
        self.assertEqual(rev['root_provisioning_independence'],'NOT_PROVEN')

    def test_positive_s0_finance_still_cannot_replace_missing_external_anchor(self):
        local=dict(self.operation,risk_class='S0')
        checked=self.guard.review(operation=local,financial=self.financial)
        self.assertEqual(checked['status'],'S0_LOCAL_ZERO_SPEND_RULE_CHECKED')
        with self.assertRaisesRegex(RevocationHold,'EXTERNAL_ANCHOR_MISSING'):
            self.revocation.review(anchor=None,envelope=self.signed_revocation())
        self.assertFalse(checked['external_provider_allowed'])

    def test_s3_attempt_with_proposed_free_provider_is_denied(self):
        operation=dict(self.operation,provider_dispatch=True,network_egress=True)
        proposed=dict(self.financial,cost_source='PROVIDER_SAYS_FREE',
            external_provider_account_id='external-provider-account')
        with self.assertRaises(FinancialHold):
            self.guard.review(operation=operation,financial=proposed)

if __name__=='__main__':unittest.main()