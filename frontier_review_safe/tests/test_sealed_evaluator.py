from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import copy
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


def results_for(built, score=.8):
    return [
        EvaluatedCaseResult(x.case_fingerprint, score, "PASS", sha256({"case": x.case_fingerprint}))
        for x in built.descriptors
    ]


def issue_receipt(built, clean, *, secret=SECRET):
    return EvaluatorReceiptAuthority.issue(
        built, results_for(built), clean, secret,
        candidate_sha="d" * 40,
        candidate_environment_hash="e" * 64,
        permissions_hash="f" * 64,
        raw_evidence_hash="1" * 64,
        started_at=NOW.isoformat(),
        completed_at=(NOW + timedelta(minutes=5)).isoformat(),
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

    def test_manifest_self_validates_exact_descriptor_case_set_binding(self):
        built = manifest()
        with self.assertRaises(FrontierSafetyError):
            replace(built, case_set_hash="a" * 64)
        with self.assertRaises(ValueError):
            replace(built, constraints_hash="z" * 64)
        with self.assertRaises(FrontierSafetyError):
            replace(built, descriptors=built.descriptors[:-1])

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
        self.assertEqual(clean["case_count_scanned"], len(private_cases))
        self.assertEqual(clean["case_fingerprint_set_hash"], sha256(sorted(manifest().case_fingerprints)))
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
        results = results_for(built)
        receipt = issue_receipt(built, clean)
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

    def test_contamination_receipt_recomputes_hash_and_binds_exact_case_set(self):
        built = manifest()
        clean = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases(), SECRET)

        tampered = copy.deepcopy(clean)
        tampered["candidate_artifact_hashes"]["candidate.py"] = "a" * 64
        with self.assertRaises(FrontierSafetyError):
            issue_receipt(built, tampered)

        wrong_count = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases()[:-1], SECRET)
        with self.assertRaises(FrontierSafetyError):
            issue_receipt(built, wrong_count)

        unrelated_cases = [replace(row, prompt=row.prompt + " changed") for row in cases()]
        same_count_wrong_set = ContaminationScanner.scan(
            {"candidate.py": "safe implementation"}, unrelated_cases, SECRET
        )
        self.assertEqual(same_count_wrong_set["case_count_scanned"], len(built.descriptors))
        with self.assertRaises(FrontierSafetyError):
            issue_receipt(built, same_count_wrong_set)

    def test_receipt_tamper_or_wrong_evaluator_key_fails_authentication(self):
        built = manifest()
        clean = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases(), SECRET)
        receipt = issue_receipt(built, clean)
        tampered = replace(receipt, raw_evidence_hash="2" * 64)
        self.assertEqual(EvaluatorReceiptAuthority.verify(tampered, built, SECRET)["status"], "FAIL")
        self.assertIn("signature_mismatch", EvaluatorReceiptAuthority.verify(tampered, built, SECRET)["reasons"])
        self.assertEqual(EvaluatorReceiptAuthority.verify(receipt, built, OTHER_SECRET)["status"], "FAIL")

    def test_correctly_signed_receipt_cannot_cross_suite_identity(self):
        built = manifest()
        clean = ContaminationScanner.scan({"candidate.py": "safe implementation"}, cases(), SECRET)
        receipt = issue_receipt(built, clean)
        wrong_suite = replace(receipt, suite_id="other-suite")
        signature = hmac.new(
            SECRET,
            canonical(EvaluatorReceiptAuthority._body(wrong_suite)).encode(),
            hashlib.sha256,
        ).hexdigest()
        wrong_suite = replace(wrong_suite, evaluator_signature=signature)
        verification = EvaluatorReceiptAuthority.verify(wrong_suite, built, SECRET)
        self.assertEqual(verification["status"], "FAIL")
        self.assertIn("suite_id_mismatch", verification["reasons"])

        with self.assertRaises(ValueError):
            replace(receipt, candidate_sha="not-an-exact-git-sha")
        with self.assertRaises(ValueError):
            replace(receipt, result_count=True)
        with self.assertRaises(ValueError):
            replace(receipt, evaluator_signature="z" * 64)

    def test_nonpass_result_must_retain_failure_category(self):
        fp = "a" * 64
        with self.assertRaises(ValueError):
            EvaluatedCaseResult(fp, 0, "ABSTAIN", "b" * 64)
        row = EvaluatedCaseResult(fp, 0, "ABSTAIN", "b" * 64, failure_category="insufficient_evidence")
        self.assertEqual(row.failure_category, "insufficient_evidence")
        with self.assertRaises(ValueError):
            EvaluatedCaseResult(fp, 1, "PASS", "b" * 64, failure_category="impossible")

    def test_policy_rejects_nonfinite_fractions_and_noninteger_counts(self):
        with self.assertRaises(ValueError):
            UnseenSuitePolicy(min_adversarial_fraction=float("nan"))
        with self.assertRaises(ValueError):
            UnseenSuitePolicy(min_cases_per_domain=1.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
