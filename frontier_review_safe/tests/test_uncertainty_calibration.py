from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.core import FrontierSafetyError, sha256
from frontier_review_safe.uncertainty_calibration import (
    DomainCalibrationRegistry,
    DomainProbabilityCalibrator,
    IntervalCoverageGate,
    IntervalCoverageObservation,
    ProbabilityCalibrationObservation,
)


NOW = datetime(2026, 9, 11, 6, 0, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()


def h(value: str) -> str:
    return sha256({"provenance": value})


class UncertaintyCalibrationTests(unittest.TestCase):
    def observations(self, *, holdout_all_correct: bool = False):
        rows = []
        for i in range(40):
            rows.append(
                ProbabilityCalibrationObservation(
                    f"cal-{i}", "risk", f"cal-group-{i}", "calibration", .9,
                    i % 2 == 0, NOW_S, h(f"cal-{i}"),
                )
            )
        for i in range(20):
            rows.append(
                ProbabilityCalibrationObservation(
                    f"hold-{i}", "risk", f"hold-group-{i}", "holdout", .9,
                    True if holdout_all_correct else i % 2 == 0,
                    (NOW + timedelta(minutes=1)).isoformat(), h(f"hold-{i}"),
                )
            )
        return rows

    def artifact(self):
        return DomainProbabilityCalibrator.fit(
            self.observations(),
            version="risk-cal-v1",
            calibrated_at=NOW_S,
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            bin_count=10,
            minimum_calibration=40,
            minimum_holdout=20,
            maximum_brier_regression=0.0,
            maximum_holdout_ece=.1,
        )

    def test_holdout_promoted_artifact_calibrates_domain_confidence(self):
        artifact = self.artifact()
        self.assertTrue(artifact.promotion_authorized)
        self.assertLess(artifact.holdout_calibrated_brier, artifact.holdout_raw_brier)
        self.assertLessEqual(artifact.holdout_ece, .1)
        registry = DomainCalibrationRegistry([artifact])
        result = registry.calibrate("risk", .9, (NOW + timedelta(hours=1)).isoformat())
        self.assertEqual(result["status"], "CALIBRATED")
        self.assertAlmostEqual(result["calibrated_confidence"], .5)
        self.assertEqual(result["artifact_sha256"], artifact.fingerprint)
        self.assertEqual(len(registry.fingerprint), 64)

    def test_split_leakage_duplicate_provenance_and_mixed_domain_fail_closed(self):
        rows = self.observations()
        rows[40] = replace(rows[40], independence_group=rows[0].independence_group)
        with self.assertRaises(FrontierSafetyError):
            DomainProbabilityCalibrator.fit(
                rows, version="v", calibrated_at=NOW_S,
                valid_until=(NOW + timedelta(days=1)).isoformat(),
                minimum_calibration=40, minimum_holdout=20,
            )

        rows = self.observations()
        rows[1] = replace(rows[1], provenance_hash=rows[0].provenance_hash)
        with self.assertRaises(FrontierSafetyError):
            DomainProbabilityCalibrator.fit(
                rows, version="v", calibrated_at=NOW_S,
                valid_until=(NOW + timedelta(days=1)).isoformat(),
                minimum_calibration=40, minimum_holdout=20,
            )

        rows = self.observations()
        rows[0] = replace(rows[0], domain="macro")
        with self.assertRaises(FrontierSafetyError):
            DomainProbabilityCalibrator.fit(
                rows, version="v", calibrated_at=NOW_S,
                valid_until=(NOW + timedelta(days=1)).isoformat(),
                minimum_calibration=40, minimum_holdout=20,
            )

    def test_stale_drifted_and_unknown_domain_calibration_fail_closed(self):
        artifact = self.artifact()
        registry = DomainCalibrationRegistry([artifact])
        with self.assertRaises(FrontierSafetyError):
            registry.calibrate("risk", .9, (NOW + timedelta(days=2)).isoformat())
        with self.assertRaises(FrontierSafetyError):
            registry.calibrate("macro", .9, (NOW + timedelta(hours=1)).isoformat())
        with self.assertRaises(FrontierSafetyError):
            registry.calibrate(
                "risk", .9, (NOW + timedelta(hours=1)).isoformat(),
                current_confidences=[.05] * 100,
                maximum_drift_psi=.2,
            )

    def test_unpromoted_artifact_cannot_authorize_confidence(self):
        artifact = DomainProbabilityCalibrator.fit(
            self.observations(holdout_all_correct=True),
            version="bad-v1",
            calibrated_at=NOW_S,
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            minimum_calibration=40,
            minimum_holdout=20,
            maximum_brier_regression=0.0,
            maximum_holdout_ece=.1,
        )
        self.assertFalse(artifact.promotion_authorized)
        registry = DomainCalibrationRegistry([artifact])
        with self.assertRaises(FrontierSafetyError):
            registry.calibrate("risk", .9, (NOW + timedelta(hours=1)).isoformat())

    def test_registry_rejects_same_domain_version_with_different_artifact(self):
        artifact = self.artifact()
        registry = DomainCalibrationRegistry([artifact])
        changed = replace(artifact, corpus_hash="f" * 64)
        with self.assertRaises(FrontierSafetyError):
            registry.register(changed)

    def test_interval_coverage_is_measured_and_fail_closed(self):
        good = [
            IntervalCoverageObservation(
                f"good-{i}", "risk", 0.0, 1.0, .5, .1, NOW_S, h(f"good-{i}")
            )
            for i in range(40)
        ]
        passed = IntervalCoverageGate.evaluate(good, domain="risk", alpha=.1, minimum_samples=30)
        self.assertEqual(passed["status"], "PASS")
        self.assertEqual(passed["empirical_coverage"], 1.0)
        self.assertEqual(len(passed["evidence_sha256"]), 64)

        poor = [
            IntervalCoverageObservation(
                f"poor-{i}", "risk", 0.0, 1.0, 2.0 if i < 10 else .5, .1, NOW_S, h(f"poor-{i}")
            )
            for i in range(40)
        ]
        failed = IntervalCoverageGate.evaluate(
            poor, domain="risk", alpha=.1, minimum_samples=30, maximum_coverage_shortfall=.03
        )
        self.assertEqual(failed["status"], "FAIL")
        self.assertGreater(failed["coverage_shortfall"], .03)

    def test_observation_and_fit_reject_nonfinite_or_malformed_authority(self):
        with self.assertRaises(ValueError):
            ProbabilityCalibrationObservation(
                "obs-nan", "risk", "group-nan", "calibration", float("nan"),
                True, NOW_S, h("obs-nan"),
            )
        with self.assertRaises(ValueError):
            ProbabilityCalibrationObservation(
                "obs-bad-hash", "risk", "group-bad-hash", "calibration", .5,
                True, NOW_S, "z" * 64,
            )
        with self.assertRaises(ValueError):
            ProbabilityCalibrationObservation(
                " ", "risk", "group-blank", "calibration", .5,
                True, NOW_S, h("obs-blank"),
            )
        with self.assertRaises(ValueError):
            DomainProbabilityCalibrator.fit(
                self.observations(), version="v-inf-regression", calibrated_at=NOW_S,
                valid_until=(NOW + timedelta(days=1)).isoformat(),
                minimum_calibration=40, minimum_holdout=20,
                maximum_brier_regression=float("inf"),
            )
        with self.assertRaises(ValueError):
            DomainProbabilityCalibrator.fit(
                self.observations(), version="v-nan-ece", calibrated_at=NOW_S,
                valid_until=(NOW + timedelta(days=1)).isoformat(),
                minimum_calibration=40, minimum_holdout=20,
                maximum_holdout_ece=float("nan"),
            )

    def test_nonfinite_confidence_and_drift_disablement_fail_closed(self):
        artifact = self.artifact()
        when = (NOW + timedelta(hours=1)).isoformat()
        with self.assertRaises(ValueError):
            artifact.calibrate(float("nan"), when)
        with self.assertRaises(ValueError):
            artifact.calibrate(
                .9, when, current_confidences=[.05] * 100,
                maximum_drift_psi=float("inf"),
            )
        with self.assertRaises(ValueError):
            DomainCalibrationRegistry([artifact]).calibrate(" ", .9, when)

    def test_artifact_rejects_nonfinite_metrics_and_false_ece_promotion(self):
        artifact = self.artifact()
        with self.assertRaises(ValueError):
            replace(artifact, holdout_raw_brier=float("nan"))
        with self.assertRaises(ValueError):
            replace(artifact, maximum_holdout_ece=float("inf"))
        with self.assertRaises(FrontierSafetyError):
            replace(
                artifact,
                promotion_authorized=True,
                holdout_ece=.2,
                maximum_holdout_ece=.1,
            )

    def test_interval_gate_rejects_threshold_disablement_and_invalid_configuration(self):
        rows = [
            IntervalCoverageObservation(
                f"cfg-{i}", "risk", 0.0, 1.0, .5, .1, NOW_S, h(f"cfg-{i}")
            )
            for i in range(40)
        ]
        with self.assertRaises(ValueError):
            IntervalCoverageGate.evaluate(
                rows, domain="risk", alpha=.1,
                maximum_coverage_shortfall=float("inf"),
            )
        with self.assertRaises(ValueError):
            IntervalCoverageGate.evaluate(rows, domain="risk", alpha=float("nan"))
        with self.assertRaises(ValueError):
            IntervalCoverageGate.evaluate(rows, domain="risk", alpha=.1, minimum_samples=0)
        with self.assertRaises(ValueError):
            IntervalCoverageGate.evaluate(rows, domain=" ", alpha=.1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
