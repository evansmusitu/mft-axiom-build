import tempfile
import unittest
from pathlib import Path

from recovery.ar07_09.adversarial import run_adversarial_qualification
from recovery.ar07_09.reliability import run_reliability_qualification


SECRET = b"candidate-test-secret-not-for-production"


class CandidateQualificationTests(unittest.TestCase):
    def test_ar08_all_local_attack_domains_are_exercised(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar08-") as td:
            report = run_adversarial_qualification(Path(td), secret_key=SECRET)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(len(report["domains"]), 11)
            self.assertTrue(all(item["status"] == "PASS" for item in report["domains"]))
            self.assertEqual(report["phase_gate"], "NOT_EARNED")
            self.assertFalse(report["independent_real_attack_surface_reproduction"])

    def test_ar09_local_fault_and_concurrency_sample_meets_candidate_targets(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar09-") as td:
            report = run_reliability_qualification(Path(td), secret_key=SECRET, sample_size=12)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["evidence_class"], "CONTROLLED_LOCAL_SAMPLE_ONLY")
            self.assertEqual(report["metrics"]["duplicate_consequential_actions"], 0)
            self.assertEqual(report["metrics"]["task_reconciliation_rate"], 1.0)
            self.assertEqual(report["metrics"]["material_provenance_rate"], 1.0)
            self.assertEqual(report["metrics"]["cross_tenant_leakage"], 0)
            self.assertGreaterEqual(report["metrics"]["transient_recovery_rate"], 0.95)
            self.assertEqual(report["phase_gate"], "NOT_EARNED")


if __name__ == "__main__":
    unittest.main()
