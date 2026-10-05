from __future__ import annotations

from dataclasses import replace
import hashlib
import hmac
import unittest

from frontier_review_safe.core import canonical
from frontier_review_safe.sealed_benchmark import SealedBenchmarkRegistry
from frontier_review_safe.sealed_suite_contract import (
    REQUIRED_UNSEEN_DOMAINS,
    SealedCaseDescriptor,
    SealedSuiteCoverageGate,
    SealedSuiteCoveragePolicy,
)


SECRET = b"sealed-suite-evaluator-secret-32bytes!!"
BASE_CONSTRAINTS = "a" * 64


class SealedSuiteCoverageTests(unittest.TestCase):
    def build_suite(self):
        payloads = []
        descriptors = []
        kinds = (["negative"] * 10) + (["adversarial"] * 10) + (["recovery"] * 5) + (["standard"] * 70)
        index = 0
        for domain in REQUIRED_UNSEEN_DOMAINS:
            for _ in range(5):
                payload = {"private_case": f"sealed evaluator case {index} for {domain}"}
                payloads.append(payload)
                fp = hmac.new(SECRET, canonical(payload).encode(), hashlib.sha256).hexdigest()
                descriptors.append(SealedCaseDescriptor(fp, domain, kinds[index], ("sealed-unseen",)))
                index += 1
        policy = SealedSuiteCoveragePolicy()
        bound_constraints = SealedSuiteCoverageGate.bind_execution_constraints(BASE_CONSTRAINTS, descriptors, policy)
        manifest = SealedBenchmarkRegistry.build(
            payloads,
            SECRET,
            suite_id="world-top-tier-unseen-v1",
            version="1",
            evaluator_key_id="eval-key-1",
            domains=REQUIRED_UNSEEN_DOMAINS,
            constraints_hash=bound_constraints,
        )
        return manifest, descriptors, policy, bound_constraints

    def test_required_unseen_suite_composition_passes_only_with_exact_membership(self):
        manifest, descriptors, policy, bound_constraints = self.build_suite()
        self.assertNotEqual(bound_constraints, BASE_CONSTRAINTS)
        self.assertEqual(manifest.constraints_hash, bound_constraints)
        report = SealedSuiteCoverageGate.validate(manifest, descriptors, policy)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["case_count"], 95)
        self.assertEqual(report["required_domain_count"], len(REQUIRED_UNSEEN_DOMAINS))
        self.assertTrue(all(v == 5 for v in report["counts_by_domain"].values()))
        self.assertEqual(report["counts_by_kind"]["negative"], 10)
        self.assertEqual(report["counts_by_kind"]["adversarial"], 10)
        self.assertEqual(report["counts_by_kind"]["recovery"], 5)
        self.assertEqual(len(report["coverage_commitment"]), 64)

        missing = SealedSuiteCoverageGate.validate(manifest, descriptors[:-1], policy)
        self.assertEqual(missing["status"], "FAIL")
        self.assertIn("sealed_cases_missing_descriptors", missing["reasons"])

    def test_relabelling_cannot_fake_domain_coverage(self):
        manifest, descriptors, policy, _ = self.build_suite()
        target = REQUIRED_UNSEEN_DOMAINS[0]
        replacement_domain = REQUIRED_UNSEEN_DOMAINS[1]
        tampered = list(descriptors)
        first = next(i for i, row in enumerate(tampered) if row.domain == target)
        tampered[first] = replace(tampered[first], domain=replacement_domain)
        report = SealedSuiteCoverageGate.validate(manifest, tampered, policy)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("required_domain_below_minimum", report["reasons"])
        self.assertIn(target, report["undercovered_domains"])

    def test_case_kind_distribution_and_adversarial_minimums_fail_closed(self):
        manifest, descriptors, policy, _ = self.build_suite()
        all_standard = [replace(row, kind="standard") for row in descriptors]
        report = SealedSuiteCoverageGate.validate(manifest, all_standard, policy)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("insufficient_negative_cases", report["reasons"])
        self.assertIn("insufficient_adversarial_cases", report["reasons"])
        self.assertIn("insufficient_recovery_cases", report["reasons"])
        self.assertIn("case_kind_distribution_too_concentrated", report["reasons"])

    def test_unknown_descriptor_case_and_domain_are_rejected(self):
        manifest, descriptors, policy, _ = self.build_suite()
        changed = list(descriptors)
        changed[0] = SealedCaseDescriptor("f" * 64, "invented_domain", changed[0].kind, ())
        report = SealedSuiteCoverageGate.validate(manifest, changed, policy)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("descriptor_contains_unknown_case", report["reasons"])
        self.assertIn("sealed_cases_missing_descriptors", report["reasons"])
        self.assertIn("descriptor_domain_not_declared_in_manifest", report["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
