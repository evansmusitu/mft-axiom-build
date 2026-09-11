from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.core import FrontierSafetyError, canonical, sha256
from frontier_review_safe.sealed_benchmark import SealedBenchmarkRegistry
from frontier_review_safe.sealed_evaluator import (
    REQUIRED_EVALUATION_DOMAINS,
    ContaminationScanner,
    EvaluatedCaseResult,
    EvaluatorReceiptAuthority,
    PrivateEvaluationCase,
    SealedSuiteBuilder,
    UnseenSuitePolicy,
)

NOW = datetime(2026, 9, 11, 4, 0, tzinfo=timezone.utc)
SECRET = b"synthetic-evaluator-secret-32-bytes!!"
OTHER_SECRET = b"different-evaluator-secret-32-bytes!"
CONSTRAINTS = "b" * 64
SCORING = "c" * 64


def cases():
    rows = []
    for i, domain in enumerate(REQUIRED_EVALUATION_DOMAINS):
        rows.append(PrivateEvaluationCase(
            case_id=f"sealed-{i:02d}",
            domain=domain,
            prompt=(
                f"Evaluate hidden scenario number {i} for {domain} using independent evidence "
                "and return a bounded defensible conclusion with uncertainty"
            ),
            reference_answer=(
                f"Reference outcome {i} requires explicit provenance uncertainty abstention when evidence is insufficient"
            ),
            rubric={"accuracy": .5, "evidence": .3, "calibration": .2},
            adversarial=(i % 3 == 0),
            negative=(i % 5 == 0),
            tool_permissions=("search", "calculator") if i % 2 == 0 else ("calculator",),
        ))
    return rows


def manifest(secret=SECRET):
    return SealedSuiteBuilder.build(
        cases(), secret,
        suite_id="axiom-unseen",
        version="2026.09.11-v1",
        evaluator_key_id="eval-key-1",
        constraints_hash=CONSTRAINTS,
        scoring_policy_hash=SCORING,
    )


class SealedEvaluatorTests(unittest.TestCase):
    def test_suite_requires_full_domain_adversarial_and_negative_coverage(self):
        built = manifest()
        self.assertEqual(len(built.descriptors), len(REQUIRED_EVALUATION_DOMAINS))
        self.assertEqual(set(x.domain for x in built.descriptors), set(REQUIRED_EVALUATION_DOMAINS))
        self.assertEqual(len(built.case_set_hash), 64)

        incomplete = cases()[:-1]
        with self.assertRaises(FrontierSafetyError):
            SealedSuiteBuilder.build(
                incomplete, SECRET,
                suite_id="bad", version="1", evaluator_key_id="eval-key-1",
                constraints_hash=CONSTRAINTS, scoring_policy_hash=SCORING,
            )

        no_attacks = [replace(x, adversarial=False, negative=False) for x in cases()]
        with self.assertRaises(FrontierSafetyError):
            SealedSuiteBuilder.build(
                no_attacks, SECRET,
                suite_id="bad", version="1", evaluator_key_id="eval-key-1",
                constraints_hash=CONSTRAINTS, scoring_policy_hash=SCORING,
            )

    def test_candidate_view_contains_only_safe_metadata(self):
        visible = manifest().candidate_view()
        text = canonical(visible).lower()
        for forbidden in ("reference outcome", "evaluate hidden scenario", "rubric", "prompt", "reference_answer"):
            self.assertNotIn(forbidden, text)
        self.assertEqual(SealedBenchmarkRegistry.validate_candidate_visible_artifact(visible)["status"], "PASS")
        with self.assertRaises(FrontierSafetyError):
            SealedBenchmarkRegistry.validate_candidate_visible_artifact({"rubric": {"secret": 1}})

    def test_registry_and_evaluator_use_same_constraint_bound_case_set_hash(self):
        private_cases = cases()
        built = manifest()
        payloads = [SealedSuiteBuilder._private_payload(x) for x in private_cases]
        legacy = SealedBenchmarkRegistry.build(
            payloads, SECRET,
            suite_id="axiom-unseen", version="2026.09.11-v1",
            evaluator_key_id="eval-key-1", domains=REQUIRED_EVALUATION_DOMAINS,
            constraints_hash=CONSTRAINTS,
        )
        self.assertEqual(legacy.case_set_hash, built.case_set_hash)
        self.assertEqual(set(legacy.case_fingerprints), set(built.case_fingerprints))

    def test_secret_rotation_changes_case_fingerprints_without_exposing_cases(self):
        first = manifest(SECRET)
        second = manifest(OTHER_SECRET)
        self.assertNotEqual(first.case_set_hash, second.case_set_hash)
        self.assertTrue(set(first.case_fingerprints).isdisjoint(set(second.case_fingerprints)))

    def test_contamination_scan_fails_without_returning_sealed_text(self):
        private_cases = cases()
        clean = ContaminationScanner.scan(
            {"candidate.py": "def safe_router(value): return value"},
            private_cases,
            SECRET,
        )
        self.assertEqual(clean["status"], "PASS")
        leaked_phrase = private_cases[0].prompt
        contaminated = ContaminationScanner.scan(
            {"candidate.py": "# memorized\n" + leaked_phrase},
            private_cases,
            SECRET,
        )
        self.assertEqual(contaminated["status"], "FAIL")
        self.assertGreaterEqual(len(contaminated["contaminated_case_fingerprints"]), 1)
        self.assertNotIn("hidden scenario", canonical(contaminated).lower())

    def test_authenticated_receipt_requires_complete_exact_suite_and_clean_contamination(self):
        built = manifest()
        clean = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases(), SECRET)
        results = [
            EvaluatedCaseResult(x.case_fingerprint, .8, "PASS", sha256({"case": x.case_fingerprint}))
            for x in built.descriptors
        ]
        receipt = EvaluatorReceiptAuthority.issue(
            built, results, clean, SECRET,
            candidate_sha="d" * 40,
            candidate_environment_hash="e" * 64,
            permissions_hash="f" * 64,
            raw_evidence_hash="1" * 64,
            started_at=NOW.isoformat(),
            completed_at=(NOW + timedelta(minutes=5)).isoformat(),
        )
        verified = EvaluatorReceiptAuthority.verify(receipt, built, SECRET)
        self.assertEqual(verified["status"], "PASS")
        self.assertEqual(verified["candidate_sha"], "d" * 40)

        with self.assertRaises(FrontierSafetyError):
            EvaluatorReceiptAuthority.issue(
                built, results[:-1], clean, SECRET,
                candidate_sha="d" * 40,
                candidate_environment_hash="e" * 64,
                permissions_hash="f" * 64,
                raw_evidence_hash="1" * 64,
                started_at=NOW.isoformat(), completed_at=(NOW + timedelta(minutes=5)).isoformat(),
            )

        contaminated = ContaminationScanner.scan({"leak.txt": cases()[0].prompt}, cases(), SECRET)
        with self.assertRaises(FrontierSafetyError):
            EvaluatorReceiptAuthority.issue(
                built, results, contaminated, SECRET,
                candidate_sha="d" * 40,
                candidate_environment_hash="e" * 64,
                permissions_hash="f" * 64,
                raw_evidence_hash="1" * 64,
                started_at=NOW.isoformat(), completed_at=(NOW + timedelta(minutes=5)).isoformat(),
            )

    def test_receipt_tamper_or_wrong_evaluator_key_fails_authentication(self):
        built = manifest()
        clean = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases(), SECRET)
        results = [
            EvaluatedCaseResult(x.case_fingerprint, .9, "PASS", sha256(x.case_fingerprint))
            for x in built.descriptors
        ]
        receipt = EvaluatorReceiptAuthority.issue(
            built, results, clean, SECRET,
            candidate_sha="d" * 40,
            candidate_environment_hash="e" * 64,
            permissions_hash="f" * 64,
            raw_evidence_hash="1" * 64,
            started_at=NOW.isoformat(), completed_at=(NOW + timedelta(minutes=1)).isoformat(),
        )
        tampered = replace(receipt, raw_evidence_hash="2" * 64)
        self.assertEqual(EvaluatorReceiptAuthority.verify(tampered, built, SECRET)["status"], "FAIL")
        self.assertIn("signature_mismatch", EvaluatorReceiptAuthority.verify(tampered, built, SECRET)["reasons"])
        self.assertEqual(EvaluatorReceiptAuthority.verify(receipt, built, OTHER_SECRET)["status"], "FAIL")

    def test_nonpass_result_must_retain_failure_category(self):
        fp = "a" * 64
        with self.assertRaises(ValueError):
            EvaluatedCaseResult(fp, 0, "ABSTAIN", "b" * 64)
        row = EvaluatedCaseResult(fp, 0, "ABSTAIN", "b" * 64, failure_category="insufficient_evidence")
        self.assertEqual(row.failure_category, "insufficient_evidence")


if __name__ == "__main__":
    unittest.main(verbosity=2)
