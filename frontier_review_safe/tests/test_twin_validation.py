from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.analysis import CausalAssumptions, CausalCounterfactualModel, ShockVariable, StructuralEquation
from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.twin_validation import (
    TwinBacktestCase,
    TwinBacktester,
    TwinCalibrationPolicy,
    TwinStressEngine,
    TwinStressSpec,
    TwinVersionCandidate,
    TwinVersionRegistry,
)

NOW = datetime(2026, 9, 11, 4, 10, tzinfo=timezone.utc)
H = "a" * 64


def model():
    return CausalCounterfactualModel([
        StructuralEquation("x", linear={"shock": 1.0}),
        StructuralEquation("y", linear={"x": 2.0}),
    ], CausalAssumptions("twin-model-v1", causal_sufficiency=True))


def backtest_cases():
    return [
        TwinBacktestCase("c1", NOW.isoformat(), {"shock": 0.0}, ({"shock": 1.0},), {"x": 1.0, "y": 2.0}, (H,)),
        TwinBacktestCase("c2", (NOW + timedelta(minutes=1)).isoformat(), {"shock": 0.0}, ({"shock": 2.0},), {"x": 2.0, "y": 4.0}, ("b" * 64,)),
    ]


class TwinValidationTests(unittest.TestCase):
    def test_replay_backtest_measures_variable_error_and_calibration_gate(self):
        report = TwinBacktester.evaluate(model(), backtest_cases(), calibrated_at=NOW.isoformat())
        self.assertEqual(report["successful_case_count"], 2)
        self.assertEqual(report["variable_metrics"]["x"]["mae"], 0)
        self.assertEqual(report["variable_metrics"]["y"]["rmse"], 0)
        policy = TwinCalibrationPolicy("cal-v1", 2, 0.0, {"x": .1, "y": .1}, 3600)
        gate = policy.gate(report, now=(NOW + timedelta(minutes=10)).isoformat())
        self.assertEqual(gate["status"], "PASS")
        self.assertEqual(len(gate["gate_sha256"]), 64)

    def test_calibration_gate_rejects_error_missing_metric_and_staleness(self):
        bad_cases = list(backtest_cases())
        bad_cases[1] = TwinBacktestCase(
            "c2", bad_cases[1].as_of, {"shock": 0.0}, ({"shock": 2.0},),
            {"x": 20.0, "y": 40.0}, ("b" * 64,),
        )
        report = TwinBacktester.evaluate(model(), bad_cases, calibrated_at=NOW.isoformat())
        policy = TwinCalibrationPolicy("cal-v1", 2, 0.0, {"x": .1, "y": .1, "z": .1}, 60)
        gate = policy.gate(report, now=(NOW + timedelta(minutes=10)).isoformat())
        self.assertEqual(gate["status"], "FAIL")
        self.assertIn("mae_exceeded:x", gate["reasons"])
        self.assertIn("mae_exceeded:y", gate["reasons"])
        self.assertIn("missing_metric:z", gate["reasons"])
        self.assertIn("calibration_stale", gate["reasons"])

    def test_twin_version_promotion_requires_calibration_and_supports_durable_rollback(self):
        report = TwinBacktester.evaluate(model(), backtest_cases(), calibrated_at=NOW.isoformat())
        policy = TwinCalibrationPolicy("cal-v1", 2, 0.0, {"x": .1, "y": .1}, 3600)
        gate = policy.gate(report, now=NOW.isoformat())
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "twins.json"
            registry = TwinVersionRegistry(path)
            v1 = TwinVersionCandidate("portfolio-1", "v1", None, "twin-model-v1", H, report["report_sha256"], "c" * 64, NOW.isoformat())
            registry.register(v1)
            registry.promote("portfolio-1", "v1", gate, occurred_at=(NOW + timedelta(seconds=1)).isoformat())
            self.assertEqual(registry.active_version("portfolio-1"), "v1")

            v2 = TwinVersionCandidate("portfolio-1", "v2", "v1", "twin-model-v1", "d" * 64, report["report_sha256"], "e" * 64,
                                      (NOW + timedelta(minutes=1)).isoformat())
            registry.register(v2)
            failed_gate = dict(gate); failed_gate["status"] = "FAIL"
            with self.assertRaises(FrontierSafetyError):
                registry.promote("portfolio-1", "v2", failed_gate, occurred_at=(NOW + timedelta(minutes=2)).isoformat())
            registry.promote("portfolio-1", "v2", gate, occurred_at=(NOW + timedelta(minutes=2)).isoformat())
            self.assertEqual(registry.active_version("portfolio-1"), "v2")
            registry.rollback("portfolio-1", "v1", occurred_at=(NOW + timedelta(minutes=3)).isoformat())
            self.assertEqual(registry.active_version("portfolio-1"), "v1")

            restarted = TwinVersionRegistry(path)
            self.assertEqual(restarted.active_version("portfolio-1"), "v1")
            self.assertTrue(restarted.verify())

    def test_twin_registry_tamper_is_detected(self):
        report = TwinBacktester.evaluate(model(), backtest_cases(), calibrated_at=NOW.isoformat())
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "twins.json"
            registry = TwinVersionRegistry(path)
            registry.register(TwinVersionCandidate("company-1", "v1", None, "twin-model-v1", H, report["report_sha256"], "c" * 64, NOW.isoformat()))
            raw = path.read_text(encoding="utf-8")
            path.write_text(raw.replace('"version":"v1"', '"version":"v9"'), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                TwinVersionRegistry(path)

    def test_probabilistic_stress_is_reproducible_and_reports_tail_quantiles(self):
        spec = TwinStressSpec(
            variables=(ShockVariable("shock", 0.0, 1.0),),
            correlation=((1.0,),), periods=3, paths=100, seed=42,
            target_metrics=("x", "y"), quantiles=(.05, .5, .95),
        )
        first = TwinStressEngine.run(model(), {"shock": 0.0}, spec)
        second = TwinStressEngine.run(model(), {"shock": 0.0}, spec)
        self.assertEqual(first["status"], "PASS")
        self.assertEqual(first["result_sha256"], second["result_sha256"])
        self.assertEqual(first["terminal_summaries"]["x"]["n"], 100)
        self.assertEqual(set(first["terminal_summaries"]["y"]["quantiles"]), {"0.05", "0.5", "0.95"})

    def test_stress_fails_closed_when_required_metric_is_missing(self):
        spec = TwinStressSpec(
            variables=(ShockVariable("shock", 0.0, 1.0),),
            correlation=((1.0,),), periods=1, paths=5, seed=1,
            target_metrics=("missing",),
        )
        result = TwinStressEngine.run(model(), {"shock": 0.0}, spec)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(len(result["failed_paths"]), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
