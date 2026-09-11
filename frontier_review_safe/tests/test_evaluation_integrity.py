from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import math
import tempfile
import unittest

from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.evaluation import (
    AdaptationRelease,
    ContinualAdaptationRegistry,
    DecisionProvenanceLedger,
    FailureRecord,
    ProofEnvelope,
    RegressionProtection,
    SealedCaseResult,
    SealedEvaluation,
)


NOW = datetime(2026, 9, 11, 9, 0, tzinfo=timezone.utc).isoformat()
H = "a" * 64


class EvaluationIntegrityTests(unittest.TestCase):
    def test_sealed_case_result_rejects_malformed_and_nonfinite_measurements(self):
        with self.assertRaises(ValueError):
            SealedCaseResult("z" * 64, 0.5)
        with self.assertRaises(ValueError):
            SealedCaseResult(H, math.nan)
        with self.assertRaises(ValueError):
            SealedCaseResult(H, 0.5, latency_ms=-1.0)
        with self.assertRaises(ValueError):
            SealedCaseResult(H, 0.5, cost_units=math.inf)

    def test_sealed_suite_hash_rejects_nonhex_and_duplicate_case_fingerprints(self):
        with self.assertRaises(ValueError):
            SealedEvaluation.suite_hash(["z" * 64], "b" * 64)
        with self.assertRaises(ValueError):
            SealedEvaluation.suite_hash([H, H], "b" * 64)
        with self.assertRaises(ValueError):
            SealedEvaluation.suite_hash([H], "q" * 64)

    def test_paired_comparison_rejects_duplicate_cases_and_invalid_sampling_contract(self):
        candidate = [SealedCaseResult(str(i).zfill(64), 0.9) for i in range(1, 6)]
        baseline = [SealedCaseResult(str(i).zfill(64), 0.5) for i in range(1, 6)]
        self.assertTrue(SealedEvaluation.paired_comparison(candidate, baseline)["statistically_positive"])
        with self.assertRaises(ValueError):
            SealedEvaluation.paired_comparison(candidate + [candidate[0]], baseline)
        with self.assertRaises(ValueError):
            SealedEvaluation.paired_comparison(candidate, baseline, confidence=1.0)
        with self.assertRaises(ValueError):
            SealedEvaluation.paired_comparison(candidate, baseline, bootstrap_samples=0)

    def test_failure_and_adaptation_records_require_real_evidence_hashes(self):
        with self.assertRaises(ValueError):
            FailureRecord("f1", "z" * 64, "security", NOW, "v1")
        with self.assertRaises(ValueError):
            FailureRecord("f1", H, "security", NOW, "v1", resolved=True)
        with self.assertRaises(ValueError):
            AdaptationRelease("v1", None, H, "q" * 64, H, H, None)
        with self.assertRaises(ValueError):
            AdaptationRelease("v1", "v1", H, H, H, H, None)

    def test_adaptation_version_collision_fails_closed(self):
        registry = ContinualAdaptationRegistry()
        v1 = AdaptationRelease("v1", None, H, "b" * 64, "c" * 64, "d" * 64, None)
        registry.promote(v1, regression_pass=True)
        with self.assertRaises(FrontierSafetyError):
            registry.promote(
                AdaptationRelease("v1", "other-parent", H, "b" * 64, "c" * 64, "d" * 64, None),
                regression_pass=True,
            )

    def test_regression_gate_rejects_nan_inf_and_invalid_tolerance(self):
        self.assertEqual(RegressionProtection.gate({"a": math.nan}, {"a": 1.0})["status"], "FAIL")
        self.assertEqual(RegressionProtection.gate({"a": math.inf}, {"a": 1.0})["status"], "FAIL")
        self.assertEqual(RegressionProtection.gate({"a": 1.0}, {"a": math.nan})["status"], "FAIL")
        self.assertEqual(RegressionProtection.gate({"a": 1.0}, {"a": 1.0}, {"a": -0.1})["status"], "FAIL")

    def test_decision_ledger_rejects_malformed_input_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = DecisionProvenanceLedger(Path(td) / "ledger.json")
            with self.assertRaises(ValueError):
                ledger.append(
                    "decision", "actor", {}, request_id="r1", policy_version="p1",
                    code_version="git:1", input_hashes=("z" * 64,),
                )

    def test_proof_envelope_rejects_nonhex_primary_or_evidence_hashes(self):
        kwargs = dict(
            request_hash=H,
            evidence_hashes=("b" * 64,),
            assumptions=("bounded",),
            method="paired-evaluation",
            result_hash="c" * 64,
            uncertainty={},
            verification={},
            authorization={},
            lineage_hash="d" * 64,
            decision_event_hash="e" * 64,
            code_version="git:1",
            policy_version="p1",
            created_at=NOW,
        )
        ProofEnvelope(**kwargs)
        with self.assertRaises(ValueError):
            ProofEnvelope(**{**kwargs, "request_hash": "z" * 64})
        with self.assertRaises(ValueError):
            ProofEnvelope(**{**kwargs, "evidence_hashes": ("q" * 64,)})


if __name__ == "__main__":
    unittest.main(verbosity=2)
