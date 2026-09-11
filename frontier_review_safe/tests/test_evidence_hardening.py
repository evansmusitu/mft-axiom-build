from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.evidence_resolution import ResearchSourceScorer
from frontier_review_safe.sealed_benchmark import EvaluatorContaminationGuard, SealedBenchmarkRegistry
from frontier_review_safe.source_calibration import SourceQualityCalibrator, SourceQualityObservation


NOW = datetime(2026, 9, 11, 5, 0, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
SECRET = b"evaluator-secret-material-32-bytes-minimum!!"
H = "a" * 64


def observation(index: int, source: str, group: str, split: str, correct: bool, *, domain: str = "markets") -> SourceQualityObservation:
    good = source == "source-good"
    return SourceQualityObservation(
        observation_id=f"obs-{index}",
        source_id=source,
        source_group=group,
        domain=domain,
        split=split,
        observed_at=(NOW + timedelta(minutes=index)).isoformat(),
        authoritative=good,
        methodologically_sound=good,
        provenance_intact=True,
        corrected_or_retracted=not good,
        outcome_correct=correct,
        provenance_hash=f"{index + 1:064x}",
    )


class EvidenceHardeningTests(unittest.TestCase):
    def calibration_rows(self):
        rows = []
        for i in range(4):
            rows.append(observation(i, "source-good", f"train-good-{i}", "train", True))
        for i in range(4, 8):
            rows.append(observation(i, "source-bad", f"train-bad-{i}", "train", False))
        rows.extend([
            observation(8, "source-good", "validation-good-1", "validation", True),
            observation(9, "source-good", "validation-good-2", "validation", True),
            observation(10, "source-bad", "validation-bad-1", "validation", False),
            observation(11, "source-bad", "validation-bad-2", "validation", False),
        ])
        return rows

    def test_source_quality_profiles_are_holdout_gated_and_pipeline_compatible(self):
        artifact = SourceQualityCalibrator.fit(
            self.calibration_rows(), version="cal-v1", trained_at=NOW_S,
            minimum_train=8, minimum_validation=4,
        )
        self.assertTrue(artifact.promotion_authorized)
        self.assertEqual(artifact.metrics[0].domain, "markets")
        self.assertLess(artifact.metrics[0].brier, artifact.metrics[0].heuristic_brier)
        profiles = artifact.profiles_for_domain("markets")
        self.assertEqual(set(profiles), {"source-good", "source-bad"})
        self.assertGreater(profiles["source-good"].historical_calibration, profiles["source-bad"].historical_calibration)
        self.assertEqual(len(artifact.fingerprint), 64)

    def test_source_quality_calibration_rejects_split_leakage_and_failed_holdout(self):
        leaked = self.calibration_rows()
        leaked[-1] = replace(leaked[-1], source_group=leaked[0].source_group)
        with self.assertRaises(FrontierSafetyError):
            SourceQualityCalibrator.fit(leaked, version="bad", trained_at=NOW_S, minimum_train=8, minimum_validation=4)

        reversed_rows = self.calibration_rows()
        reversed_rows = [
            replace(row, outcome_correct=(not row.outcome_correct)) if row.split == "validation" else row
            for row in reversed_rows
        ]
        artifact = SourceQualityCalibrator.fit(
            reversed_rows, version="cal-regressed", trained_at=NOW_S,
            minimum_train=8, minimum_validation=4,
        )
        self.assertFalse(artifact.promotion_authorized)
        with self.assertRaises(FrontierSafetyError):
            artifact.profiles_for_domain("markets")

    def test_sealed_custody_receipt_is_authenticated_but_not_misrepresented_as_independent(self):
        cases = [
            {"prompt": "Evaluate the liquidity shock propagation across this sealed portfolio scenario one"},
            {"prompt": "Resolve the conflicting evidence chain for this sealed macro scenario two"},
        ]
        manifest = SealedBenchmarkRegistry.build(
            cases, SECRET, suite_id="suite-1", version="1", evaluator_key_id="eval-key-1",
            domains=("risk", "contradiction"), constraints_hash=H,
        )
        receipt = SealedBenchmarkRegistry.create_custody_receipt(
            manifest, SECRET, evaluator_org="Independent Evaluator A", sealed_at=NOW_S,
            candidate_sha="b" * 40, candidate_frozen_at=(NOW - timedelta(hours=1)).isoformat(),
        )
        verified = SealedBenchmarkRegistry.verify_custody_receipt(
            manifest, receipt, SECRET, expected_candidate_sha="b" * 40,
        )
        self.assertEqual(verified["status"], "PASS")
        self.assertFalse(verified["independent_validation"])
        tampered = replace(receipt, candidate_sha="c" * 40)
        self.assertEqual(
            SealedBenchmarkRegistry.verify_custody_receipt(manifest, tampered, SECRET, expected_candidate_sha="c" * 40)["status"],
            "FAIL",
        )

    def test_sealed_authority_rejects_pseudo_hashes_inexact_candidate_sha_and_time_reversal(self):
        cases = [{"prompt": "sealed evaluator case"}]
        with self.assertRaises(ValueError):
            SealedBenchmarkRegistry.build(
                cases, SECRET, suite_id="suite-bad", version="1", evaluator_key_id="eval-key-1",
                domains=("risk",), constraints_hash="z" * 64,
            )
        manifest = SealedBenchmarkRegistry.build(
            cases, SECRET, suite_id="suite-strict", version="1", evaluator_key_id="eval-key-1",
            domains=("risk",), constraints_hash=H,
        )
        with self.assertRaises(ValueError):
            SealedBenchmarkRegistry.create_custody_receipt(
                manifest, SECRET, evaluator_org="Independent Evaluator A", sealed_at=NOW_S,
                candidate_sha="z" * 40, candidate_frozen_at=(NOW - timedelta(hours=1)).isoformat(),
            )
        with self.assertRaises(ValueError):
            SealedBenchmarkRegistry.create_custody_receipt(
                manifest, SECRET, evaluator_org="Independent Evaluator A",
                sealed_at=(NOW - timedelta(hours=2)).isoformat(), candidate_sha="b" * 40,
                candidate_frozen_at=NOW_S,
            )
        receipt = SealedBenchmarkRegistry.create_custody_receipt(
            manifest, SECRET, evaluator_org="Independent Evaluator A", sealed_at=NOW_S,
            candidate_sha="b" * 40, candidate_frozen_at=(NOW - timedelta(hours=1)).isoformat(),
        )
        with self.assertRaises(ValueError):
            SealedBenchmarkRegistry.verify_custody_receipt(
                manifest, receipt, SECRET, expected_candidate_sha="z" * 40,
            )

    def test_sealed_domain_coverage_and_disguised_contamination_fail_closed(self):
        sealed = [
            {"prompt": "compute the exact reverse stress threshold for correlated rates credit and liquidity shocks in portfolio alpha"},
            {"prompt": "compare contradictory primary filings and determine which evidence remains independently corroborated after dependency collapse"},
        ]
        manifest = SealedBenchmarkRegistry.build(
            sealed, SECRET, suite_id="suite-2", version="1", evaluator_key_id="eval-key-1",
            domains=("risk", "contradiction"), constraints_hash=H,
        )
        coverage = SealedBenchmarkRegistry.validate_domain_coverage(manifest, ("risk", "contradiction", "governance"))
        self.assertEqual(coverage["status"], "FAIL")
        self.assertEqual(coverage["missing_domains"], ["governance"])

        disguised_leak = {
            "notes": {
                "text": "compute the exact reverse stress threshold for correlated rates credit and liquidity shocks in portfolio alpha"
            }
        }
        leaked = EvaluatorContaminationGuard.scan(sealed, disguised_leak, SECRET)
        self.assertEqual(leaked["status"], "FAIL")
        self.assertGreater(leaked["matched_fingerprint_count"], 0)
        self.assertNotIn("matches", leaked)

        clean = EvaluatorContaminationGuard.scan(
            sealed,
            {"notes": {"text": "generic candidate implementation documentation with no evaluator case content present here at all"}},
            SECRET,
        )
        self.assertEqual(clean["status"], "PASS")
        self.assertEqual(clean["matched_fingerprint_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
