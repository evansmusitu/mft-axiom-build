"""Adversarial S0 evidence integrity: clock callbacks may mutate caller data.

Local signatures are genuine ephemeral fixtures; no independent custody or release.
"""
import hashlib
import unittest

from ops.iso_trust_boundary.preconsumption_evidence import PreconsumptionHold
from ops.iso_trust_boundary.test import test_preconsumption_evidence as fixtures


class ImmutableEvidenceInputTests(unittest.TestCase):
    def setUp(self):
        self.lab = fixtures.S0PreconsumptionContractTests('test_genuine_local_synthetic_signatures_remain_evidence_only')
        self.lab.setUp()
        self.addCleanup(self.lab.doCleanups)

    def test_signed_receipt_window_cannot_be_mutated_by_revocation_clock(self):
        p = self.lab
        p.lab.receipt['issued_at_unix'] = 180
        p.lab.receipt['expires_at_unix'] = 200
        p.lab.verifier.clock = lambda: 190
        p.checkpoint_body['receipt_sha256'] = hashlib.sha256(fixtures.canonical(p.lab.receipt)).hexdigest()

        # This is an untrusted callback; signature over receipt is verified first.
        # Original signed interval [180,200) has NO intersection with [205,230).
        def mutate_receipt():
            p.lab.receipt['issued_at_unix'] = 210
            p.lab.receipt['expires_at_unix'] = 220
            return 210
        p.lab.revocation.clock = mutate_receipt
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_signed_revocation_window_cannot_be_mutated_by_checkpoint_clock(self):
        p = self.lab
        p.lab.revocation_body['issued_at_unix'] = 175
        p.lab.revocation_body['expires_at_unix'] = 190
        p.lab.revocation.clock = lambda: 180

        def mutate_revocation():
            p.lab.revocation_body['issued_at_unix'] = 205
            p.lab.revocation_body['expires_at_unix'] = 225
            return 210
        p.checkpoint.clock = mutate_revocation
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_finance_approved_operation_cannot_switch_to_provider_dispatch_later(self):
        p = self.lab
        def mutate_operation():
            p.lab.operation['provider_dispatch'] = True
            return 210
        p.lab.verifier.clock = mutate_operation
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_billable_cost_can_not_be_injected_after_finance_review(self):
        p = self.lab
        def mutate_financial():
            p.lab.financial['quoted_max_charge_micro_usd'] = 5000000
            return 210
        p.lab.verifier.clock = mutate_financial
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_signed_nonce_cannot_change_after_receipt_verification(self):
        p = self.lab
        def mutate_nonce():
            p.lab.receipt['nonce'] = 'f' * 32
            return 210
        p.lab.revocation.clock = mutate_nonce
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_expected_request_cannot_change_after_receipt_verification(self):
        p = self.lab
        def mutate_expected():
            p.lab.op_expected['nonce'] = 'f' * 32
            return 210
        p.lab.revocation.clock = mutate_expected
        inputs = p.inputs()
        with self.assertRaisesRegex(PreconsumptionHold, 'INPUT_MUTATED_AFTER_REVIEW'):
            p.reviewer.review(**inputs)

    def test_unchanged_input_is_evidence_only(self):
        p = self.lab
        result = p.reviewer.review(**p.inputs())
        self.assertFalse(result['execution_allowed'])
        self.assertFalse(result['reservation_issued'])
        self.assertEqual(result['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')


if __name__ == '__main__':
    unittest.main()
