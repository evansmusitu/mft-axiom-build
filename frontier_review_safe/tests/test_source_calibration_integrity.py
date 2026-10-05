from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import math
import unittest

from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.source_calibration import (
    SourceCalibrationMetric,
    SourceQualityCalibrationArtifact,
    SourceQualityCalibrator,
    SourceQualityObservation,
)


NOW = datetime(2026, 9, 11, 9, 5, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()


def row(index: int, *, split: str, source: str, group: str, correct: bool) -> SourceQualityObservation:
    return SourceQualityObservation(
        observation_id=f"obs-{index}",
        source_id=source,
        source_group=group,
        domain="markets",
        split=split,
        observed_at=(NOW + timedelta(minutes=index)).isoformat(),
        authoritative=source == "good",
        methodologically_sound=source == "good",
        provenance_intact=True,
        corrected_or_retracted=source != "good",
        outcome_correct=correct,
        provenance_hash=f"{index + 1:064x}",
    )


def corpus():
    rows = [row(i, split="train", source="good", group=f"tg-{i}", correct=True) for i in range(4)]
    rows += [row(i, split="train", source="bad", group=f"tb-{i}", correct=False) for i in range(4, 8)]
    rows += [
        row(8, split="validation", source="good", group="vg-1", correct=True),
        row(9, split="validation", source="good", group="vg-2", correct=True),
        row(10, split="validation", source="bad", group="vb-1", correct=False),
        row(11, split="validation", source="bad", group="vb-2", correct=False),
    ]
    return rows


class SourceCalibrationIntegrityTests(unittest.TestCase):
    def test_observation_rejects_pseudo_hash_and_blank_identity(self):
        valid = row(0, split="train", source="good", group="g", correct=True)
        with self.assertRaises(ValueError):
            replace(valid, provenance_hash="z" * 64)
        with self.assertRaises(ValueError):
            replace(valid, source_id="   ")

    def test_metric_rejects_nonfinite_or_out_of_range_values(self):
        SourceCalibrationMetric("markets", 4, 0.1, 0.25, 0.15, True)
        with self.assertRaises(ValueError):
            SourceCalibrationMetric("markets", 4, math.nan, 0.25, 0.0, False)
        with self.assertRaises(ValueError):
            SourceCalibrationMetric("markets", 4, 1.1, 0.25, -0.85, False)
        with self.assertRaises(ValueError):
            SourceCalibrationMetric("markets", 0, 0.1, 0.25, 0.15, True)

    def test_fit_rejects_blank_version_invalid_threshold_types_and_bad_tolerance(self):
        rows = corpus()
        with self.assertRaises(ValueError):
            SourceQualityCalibrator.fit(rows, version="   ", trained_at=NOW_S)
        with self.assertRaises(ValueError):
            SourceQualityCalibrator.fit(rows, version="v1", trained_at=NOW_S, minimum_train=True)
        with self.assertRaises(ValueError):
            SourceQualityCalibrator.fit(rows, version="v1", trained_at=NOW_S, maximum_brier_regression=math.nan)
        with self.assertRaises(ValueError):
            SourceQualityCalibrator.fit(rows, version="v1", trained_at=NOW_S, maximum_brier_regression=-0.01)

    def test_artifact_rejects_pseudo_corpus_hash_and_false_promotion_laundering(self):
        artifact = SourceQualityCalibrator.fit(corpus(), version="v1", trained_at=NOW_S)
        with self.assertRaises(ValueError):
            replace(artifact, corpus_hash="q" * 64)
        denied_metric = SourceCalibrationMetric("markets", 4, 0.4, 0.25, -0.15, False)
        with self.assertRaises(FrontierSafetyError):
            replace(artifact, metrics=(denied_metric,), promotion_authorized=True)

    def test_brier_rejects_nonfinite_probabilities_and_nonbinary_labels(self):
        with self.assertRaises(ValueError):
            SourceQualityCalibrator._brier([math.inf], [1])
        with self.assertRaises(ValueError):
            SourceQualityCalibrator._brier([0.5], [2])


if __name__ == "__main__":
    unittest.main(verbosity=2)
