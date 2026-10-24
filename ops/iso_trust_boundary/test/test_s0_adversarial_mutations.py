"""Deterministic adversarial input matrix; no trusted external security claim."""
import itertools
import unittest

from ops.iso_trust_boundary.financial_zero_boundary import FinancialHold
from ops.iso_trust_boundary.revocation_snapshot_review import RevocationHold
from ops.iso_trust_boundary.test import test_financial_zero_boundary as financial_fixtures
from ops.iso_trust_boundary.test import test_revocation_snapshot_review as revocation_fixtures


class AdversarialMutations(unittest.TestCase):
    def setUp(self):
        self.finance=financial_fixtures.FinancialZeroBoundaryTests('test_local_pure_compute_only_yields_non_execution_evidence')
        self.finance.setUp()
        self.revocation=revocation_fixtures.ReviewTests('test_valid_pinned_revocation_snapshot_is_evidence_only')
        self.revocation.setUp()

    def test_financial_64_combinations_never_issue_authority(self):
        # Includes deceptive zero quote for account/credits, network, dispatch,
        # S3-like state mutation and unknown-cost toggles.
        keys=('provider_dispatch','network_egress','external_state_write')
        cost_keys=('billing_method_enabled','billing_credits_available','cost_unknown')
        tested=0
        for flags in itertools.product((False,True),repeat=6):
            operation=dict(self.finance.operation)
            financial=dict(self.finance.financial)
            operation.update(dict(zip(keys,flags[:3])))
            financial.update(dict(zip(cost_keys,flags[3:])))
            try:
                out=self.finance.boundary.review(operation=operation,financial=financial)
                self.assertEqual(flags,(False,)*6)
                self.assertIs(out['execution_allowed'],False)
                self.assertIs(out['external_provider_allowed'],False)
                self.assertEqual(out['account_wide_zero_hard_cap'],'NOT_PROVEN')
            except FinancialHold:
                self.assertNotEqual(flags,(False,)*6)
            tested+=1
        self.assertEqual(tested,64)

    def test_signed_revocation_tamper_matrix_denies_every_pinned_invariant(self):
        mutations=(
            ('revocation_authority_id','rogue'),
            ('operator_id','rogue'),('witness_id','rogue'),
            ('root_epoch',0),('root_epoch',6),('policy_sha256','f'*64),
            ('operator_epoch',10),('witness_epoch',13),
            ('previous_revision',30),('previous_revision',32),
            ('previous_digest','d'*64),('revision',33),
            ('issued_at_unix',500),('expires_at_unix',500),
            ('status','ISSUE_GRANT'),('schema','unknown'),
            ('revoked_operator_epochs',[3,6,9]),
            ('revoked_witness_epochs',[2,8,12]),
        )
        for key,value in mutations:
            with self.subTest(key=key,value=value):
                body=dict(self.revocation.snapshot,**{key:value})
                with self.assertRaises(RevocationHold):
                    self.revocation.judge(envelope=self.revocation.signed(body))
        self.assertEqual(len(mutations),18)

    def test_valid_signer_forged_collateral_claim_cannot_expand_scope(self):
        payload=dict(self.revocation.snapshot, release_permission='PRODUCTION')
        with self.assertRaisesRegex(RevocationHold,'EXACT_SNAPSHOT_FIELDS'):
            self.revocation.judge(envelope=self.revocation.signed(payload))

    def test_valid_revocation_signature_with_totally_rolled_back_anchor_remains_failure(self):
        initial=self.revocation.judge()
        replay=self.revocation.judge(anchor={'revision':31,'digest':'a'*64})
        self.assertEqual(initial['snapshot_sha256'],replay['snapshot_sha256'])
        self.assertEqual(replay['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertIs(replay['production_authority'],False)

if __name__=='__main__': unittest.main()
