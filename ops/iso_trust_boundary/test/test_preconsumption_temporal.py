"""S0 local adversarial review: signed time ranges must overlap.

No independent clocks or security qualification. Disjoint ranges reveal a
consistency defect even when each caller-controlled verifier separately passes.
"""
import hashlib
import unittest

from ops.iso_trust_boundary.preconsumption_evidence import PreconsumptionHold
from ops.iso_trust_boundary.test import test_preconsumption_evidence as fixtures


class TemporalEvidenceOverlapTests(unittest.TestCase):
    def setUp(self):
        self.lab = fixtures.S0PreconsumptionContractTests('test_genuine_local_synthetic_signatures_remain_evidence_only')
        self.lab.setUp()
        self.addCleanup(self.lab.doCleanups)

    def signed_ranges(self, receipt, revocation, checkpoint):
        p = self.lab
        p.lab.receipt['issued_at_unix'], p.lab.receipt['expires_at_unix'] = receipt
        p.lab.revocation_body['issued_at_unix'], p.lab.revocation_body['expires_at_unix'] = revocation
        p.checkpoint_body['issued_at_unix'], p.checkpoint_body['expires_at_unix'] = checkpoint
        p.checkpoint_body['receipt_sha256'] = hashlib.sha256(fixtures.canonical(p.lab.receipt)).hexdigest()
        p.lab.verifier.clock = lambda: receipt[0] + 1
        p.lab.revocation.clock = lambda: revocation[0] + 1
        p.checkpoint.clock = lambda: checkpoint[0] + 1
        return p.inputs()

    def test_disjoint_signed_intervals_are_rejected_even_with_three_valid_signatures(self):
        params = self.signed_ranges((100, 120), (200, 220), (300, 320))
        with self.assertRaisesRegex(PreconsumptionHold, 'NON_OVERLAPPING_SIGNED_EVIDENCE_TTL'):
            self.lab.reviewer.review(**params)

    def test_pairwise_overlap_without_triple_intersection_rejected(self):
        params = self.signed_ranges((100, 125), (120, 145), (140, 165))
        with self.assertRaisesRegex(PreconsumptionHold, 'NON_OVERLAPPING_SIGNED_EVIDENCE_TTL'):
            self.lab.reviewer.review(**params)

    def test_touching_open_boundary_not_represented_as_valid_overlap(self):
        params = self.signed_ranges((100, 120), (120, 140), (120, 145))
        with self.assertRaisesRegex(PreconsumptionHold, 'NON_OVERLAPPING_SIGNED_EVIDENCE_TTL'):
            self.lab.reviewer.review(**params)

    def test_overlapping_proofs_return_bounded_possible_validity_window_only(self):
        params = self.signed_ranges((100, 130), (110, 140), (115, 145))
        result = self.lab.reviewer.review(**params)
        self.assertEqual(result['signed_evidence_possible_valid_from_unix'], 115)
        self.assertEqual(result['signed_evidence_possible_valid_until_unix'], 130)
        self.assertEqual(result['clock_independence'], 'NOT_PROVEN')
        self.assertFalse(result['execution_allowed'])
        self.assertFalse(result['reservation_issued'])
        self.assertEqual(result['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')

if __name__=='__main__': unittest.main()
