from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence
import math

from .core import FrontierSafetyError, parse_time, sha256


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


@dataclass(frozen=True)
class ProbabilityCalibrationObservation:
    observation_id: str
    domain: str
    independence_group: str
    split: str
    predicted_confidence: float
    correct: bool
    observed_at: str
    provenance_hash: str

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip() for value in (self.observation_id, self.domain, self.independence_group)):
            raise ValueError("calibration observation identity fields are required")
        if self.split not in {"calibration", "holdout"}:
            raise ValueError("split must be calibration or holdout")
        confidence = float(self.predicted_confidence)
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("predicted_confidence must be finite and in [0,1]")
        if not isinstance(self.correct, bool):
            raise ValueError("correct must be boolean")
        parse_time(self.observed_at)
        if not _valid_sha256(self.provenance_hash):
            raise ValueError("calibration provenance_hash must be SHA-256")


@dataclass(frozen=True)
class CalibrationBin:
    lower: float
    upper: float
    count: int
    correct_count: int
    calibrated_confidence: float

    def __post_init__(self) -> None:
        lower = float(self.lower)
        upper = float(self.upper)
        calibrated = float(self.calibrated_confidence)
        if not all(math.isfinite(value) for value in (lower, upper, calibrated)):
            raise ValueError("calibration bin values must be finite")
        if not (0.0 <= lower < upper <= 1.0):
            raise ValueError("invalid calibration bin bounds")
        if any(not isinstance(value, int) or isinstance(value, bool) for value in (self.count, self.correct_count)):
            raise ValueError("calibration bin counts must be integers")
        if self.count < 0 or self.correct_count < 0 or self.correct_count > self.count:
            raise ValueError("invalid calibration bin counts")
        if not 0.0 <= calibrated <= 1.0:
            raise ValueError("calibrated confidence must be in [0,1]")


@dataclass(frozen=True)
class DomainProbabilityCalibrationArtifact:
    schema: str
    version: str
    domain: str
    calibrated_at: str
    valid_until: str
    corpus_hash: str
    bins: tuple[CalibrationBin, ...]
    reference_histogram: tuple[float, ...]
    calibration_count: int
    holdout_count: int
    holdout_raw_brier: float
    holdout_calibrated_brier: float
    holdout_ece: float
    maximum_holdout_ece: float
    calibration_groups: tuple[str, ...]
    holdout_groups: tuple[str, ...]
    promotion_authorized: bool
    maximum_brier_regression: float = 0.0

    def __post_init__(self) -> None:
        if self.schema != "musitu.axiom.domain-probability-calibration.v1":
            raise ValueError("unsupported uncertainty calibration schema")
        if any(not isinstance(value, str) or not value.strip() for value in (self.version, self.domain)):
            raise ValueError("calibration version and domain are required")
        start = parse_time(self.calibrated_at)
        end = parse_time(self.valid_until)
        if end <= start:
            raise ValueError("valid_until must be after calibrated_at")
        if not _valid_sha256(self.corpus_hash):
            raise ValueError("calibration corpus_hash must be SHA-256")
        if not self.bins or len(self.bins) != len(self.reference_histogram):
            raise ValueError("calibration bins and reference histogram must align")
        if any(not isinstance(value, int) or isinstance(value, bool) or value <= 0 for value in (self.calibration_count, self.holdout_count)):
            raise ValueError("calibration and holdout sample counts must be positive integers")
        if any(not isinstance(group, str) or not group.strip() for group in (*self.calibration_groups, *self.holdout_groups)):
            raise ValueError("calibration independence groups must be non-empty strings")
        if len(self.calibration_groups) != len(set(self.calibration_groups)) or len(self.holdout_groups) != len(set(self.holdout_groups)):
            raise ValueError("duplicate uncertainty calibration independence group")
        if set(self.calibration_groups) & set(self.holdout_groups):
            raise FrontierSafetyError("independence-group leakage between calibration and holdout")
        metrics = tuple(float(x) for x in (
            self.holdout_raw_brier,
            self.holdout_calibrated_brier,
            self.holdout_ece,
            self.maximum_holdout_ece,
            self.maximum_brier_regression,
        ))
        if any(not math.isfinite(value) for value in metrics):
            raise ValueError("calibration metrics and thresholds must be finite")
        if not 0.0 <= metrics[0] <= 1.0 or not 0.0 <= metrics[1] <= 1.0:
            raise ValueError("holdout Brier scores must be within [0,1]")
        if not 0.0 <= metrics[2] <= 1.0 or not 0.0 <= metrics[3] <= 1.0:
            raise ValueError("holdout ECE values must be within [0,1]")
        if not 0.0 <= metrics[4] <= 1.0:
            raise ValueError("maximum_brier_regression must be within [0,1]")
        histogram = tuple(float(value) for value in self.reference_histogram)
        if any(not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in histogram):
            raise ValueError("reference histogram entries must be finite probabilities")
        if not math.isclose(sum(histogram), 1.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("reference histogram must sum to one")
        if not isinstance(self.promotion_authorized, bool):
            raise ValueError("promotion_authorized must be boolean")
        if self.promotion_authorized and self.holdout_calibrated_brier > self.holdout_raw_brier + self.maximum_brier_regression:
            raise FrontierSafetyError("promoted uncertainty calibration exceeds declared Brier regression limit")
        if self.promotion_authorized and self.holdout_ece > self.maximum_holdout_ece:
            raise FrontierSafetyError("promoted uncertainty calibration exceeds declared holdout ECE limit")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    def _bin_index(self, confidence: float) -> int:
        confidence = float(confidence)
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence must be finite and in [0,1]")
        for index, row in enumerate(self.bins):
            if confidence < row.upper or index == len(self.bins) - 1:
                return index
        return len(self.bins) - 1

    def calibrate(
        self,
        confidence: float,
        at: str,
        *,
        current_confidences: Sequence[float] | None = None,
        maximum_drift_psi: float = 0.2,
        require_promoted: bool = True,
    ) -> dict[str, Any]:
        when = parse_time(at)
        if require_promoted and not self.promotion_authorized:
            raise FrontierSafetyError("domain uncertainty calibration artifact is not promoted")
        if when < parse_time(self.calibrated_at) or when >= parse_time(self.valid_until):
            raise FrontierSafetyError("domain uncertainty calibration artifact is stale or not yet effective")
        maximum_drift = float(maximum_drift_psi)
        if not math.isfinite(maximum_drift) or maximum_drift < 0.0:
            raise ValueError("maximum_drift_psi must be finite and non-negative")
        drift = None
        if current_confidences is not None:
            drift = self.drift_psi(current_confidences)
            if drift > maximum_drift:
                raise FrontierSafetyError("domain uncertainty calibration drift exceeds limit")
        confidence_value = float(confidence)
        index = self._bin_index(confidence_value)
        row = self.bins[index]
        return {
            "status": "CALIBRATED",
            "domain": self.domain,
            "version": self.version,
            "raw_confidence": confidence_value,
            "calibrated_confidence": row.calibrated_confidence,
            "bin_index": index,
            "bin_count": row.count,
            "drift_psi": drift,
            "artifact_sha256": self.fingerprint,
        }

    def drift_psi(self, current_confidences: Sequence[float]) -> float:
        if not current_confidences:
            raise ValueError("current confidence window is required")
        counts = [0] * len(self.bins)
        for value in current_confidences:
            counts[self._bin_index(float(value))] += 1
        total = len(current_confidences)
        current = [count / total for count in counts]
        epsilon = 1e-6
        result = sum(
            (max(epsilon, cur) - max(epsilon, ref))
            * math.log(max(epsilon, cur) / max(epsilon, ref))
            for ref, cur in zip(self.reference_histogram, current)
        )
        if not math.isfinite(result) or result < 0.0:
            raise FrontierSafetyError("invalid uncertainty calibration drift measurement")
        return result


class DomainProbabilityCalibrator:
    @staticmethod
    def _brier(probabilities: Sequence[float], outcomes: Sequence[int]) -> float:
        if not probabilities or len(probabilities) != len(outcomes):
            raise ValueError("equal non-empty probabilities/outcomes required")
        values = [float(p) for p in probabilities]
        labels = [int(y) for y in outcomes]
        if any(not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in values):
            raise ValueError("probabilities must be finite and within [0,1]")
        if any(label not in {0, 1} for label in labels):
            raise ValueError("outcomes must be binary")
        return sum((p - y) ** 2 for p, y in zip(values, labels)) / len(values)

    @staticmethod
    def _ece(probabilities: Sequence[float], outcomes: Sequence[int], bin_count: int) -> float:
        if not probabilities or len(probabilities) != len(outcomes):
            raise ValueError("equal non-empty probabilities/outcomes required")
        if not isinstance(bin_count, int) or isinstance(bin_count, bool) or bin_count < 2:
            raise ValueError("bin_count must be an integer >=2")
        values = [float(p) for p in probabilities]
        labels = [int(y) for y in outcomes]
        if any(not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in values):
            raise ValueError("probabilities must be finite and within [0,1]")
        if any(label not in {0, 1} for label in labels):
            raise ValueError("outcomes must be binary")
        groups: list[list[tuple[float, int]]] = [[] for _ in range(bin_count)]
        for probability, outcome in zip(values, labels):
            index = min(bin_count - 1, int(probability * bin_count))
            groups[index].append((probability, outcome))
        total = len(values)
        ece = 0.0
        for group in groups:
            if not group:
                continue
            confidence = sum(x[0] for x in group) / len(group)
            accuracy = sum(x[1] for x in group) / len(group)
            ece += len(group) / total * abs(confidence - accuracy)
        return ece

    @classmethod
    def fit(
        cls,
        observations: Sequence[ProbabilityCalibrationObservation],
        *,
        version: str,
        calibrated_at: str,
        valid_until: str,
        bin_count: int = 10,
        minimum_calibration: int = 30,
        minimum_holdout: int = 20,
        maximum_brier_regression: float = 0.0,
        maximum_holdout_ece: float = 0.1,
    ) -> DomainProbabilityCalibrationArtifact:
        parse_time(calibrated_at)
        parse_time(valid_until)
        if not observations:
            raise ValueError("calibration observations required")
        if not isinstance(version, str) or not version.strip():
            raise ValueError("calibration version required")
        if not isinstance(bin_count, int) or isinstance(bin_count, bool) or bin_count < 2:
            raise ValueError("bin_count must be an integer >=2")
        for name, value in (("minimum_calibration", minimum_calibration), ("minimum_holdout", minimum_holdout)):
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        maximum_regression = float(maximum_brier_regression)
        maximum_ece = float(maximum_holdout_ece)
        if not math.isfinite(maximum_regression) or not 0.0 <= maximum_regression <= 1.0:
            raise ValueError("maximum_brier_regression must be finite and in [0,1]")
        if not math.isfinite(maximum_ece) or not 0.0 <= maximum_ece <= 1.0:
            raise ValueError("maximum_holdout_ece must be finite and in [0,1]")

        domains = {row.domain for row in observations}
        if len(domains) != 1:
            raise FrontierSafetyError("one domain per uncertainty calibration artifact is required")
        ids = [row.observation_id for row in observations]
        provenance = [row.provenance_hash for row in observations]
        if len(ids) != len(set(ids)):
            raise FrontierSafetyError("duplicate calibration observation id")
        if len(provenance) != len(set(provenance)):
            raise FrontierSafetyError("duplicate uncertainty calibration provenance record")

        calibration = [row for row in observations if row.split == "calibration"]
        holdout = [row for row in observations if row.split == "holdout"]
        calibration_groups = {row.independence_group for row in calibration}
        holdout_groups = {row.independence_group for row in holdout}
        if calibration_groups & holdout_groups:
            raise FrontierSafetyError("independence-group leakage between calibration and holdout")
        if len(calibration) < minimum_calibration or len(holdout) < minimum_holdout:
            raise FrontierSafetyError("insufficient leakage-separated uncertainty calibration samples")

        counts = [0] * bin_count
        correct = [0] * bin_count
        for row in calibration:
            index = min(bin_count - 1, int(float(row.predicted_confidence) * bin_count))
            counts[index] += 1
            correct[index] += int(row.correct)

        bins: list[CalibrationBin] = []
        for index in range(bin_count):
            lower = index / bin_count
            upper = (index + 1) / bin_count
            if counts[index]:
                calibrated = (correct[index] + 1.0) / (counts[index] + 2.0)
            else:
                calibrated = (lower + upper) / 2.0
            bins.append(CalibrationBin(lower, upper, counts[index], correct[index], calibrated))

        def calibrated_probability(value: float) -> float:
            index = min(bin_count - 1, int(float(value) * bin_count))
            return bins[index].calibrated_confidence

        holdout_raw = [float(row.predicted_confidence) for row in holdout]
        holdout_calibrated = [calibrated_probability(row.predicted_confidence) for row in holdout]
        outcomes = [1 if row.correct else 0 for row in holdout]
        raw_brier = cls._brier(holdout_raw, outcomes)
        calibrated_brier = cls._brier(holdout_calibrated, outcomes)
        ece = cls._ece(holdout_calibrated, outcomes, bin_count)
        promoted = (
            calibrated_brier <= raw_brier + maximum_regression
            and ece <= maximum_ece
        )
        reference_histogram = tuple(count / len(calibration) for count in counts)
        corpus_hash = sha256([asdict(row) for row in sorted(observations, key=lambda x: x.observation_id)])
        return DomainProbabilityCalibrationArtifact(
            "musitu.axiom.domain-probability-calibration.v1",
            version,
            next(iter(domains)),
            calibrated_at,
            valid_until,
            corpus_hash,
            tuple(bins),
            reference_histogram,
            len(calibration),
            len(holdout),
            raw_brier,
            calibrated_brier,
            ece,
            maximum_ece,
            tuple(sorted(calibration_groups)),
            tuple(sorted(holdout_groups)),
            promoted,
            maximum_regression,
        )


class DomainCalibrationRegistry:
    def __init__(self, artifacts: Sequence[DomainProbabilityCalibrationArtifact] = ()) -> None:
        self._artifacts: dict[tuple[str, str], DomainProbabilityCalibrationArtifact] = {}
        for artifact in artifacts:
            self.register(artifact)

    def register(self, artifact: DomainProbabilityCalibrationArtifact) -> None:
        key = (artifact.domain, artifact.version)
        old = self._artifacts.get(key)
        if old is not None and old.fingerprint != artifact.fingerprint:
            raise FrontierSafetyError("uncertainty calibration version collision")
        self._artifacts[key] = artifact

    @property
    def fingerprint(self) -> str:
        return sha256([
            (domain, version, artifact.fingerprint)
            for (domain, version), artifact in sorted(self._artifacts.items())
        ])

    def calibrate(
        self,
        domain: str,
        confidence: float,
        at: str,
        *,
        current_confidences: Sequence[float] | None = None,
        maximum_drift_psi: float = 0.2,
    ) -> dict[str, Any]:
        if not isinstance(domain, str) or not domain.strip():
            raise ValueError("calibration domain required")
        when = parse_time(at)
        candidates = [
            artifact
            for (artifact_domain, _), artifact in self._artifacts.items()
            if artifact_domain == domain
            and artifact.promotion_authorized
            and parse_time(artifact.calibrated_at) <= when < parse_time(artifact.valid_until)
        ]
        if not candidates:
            raise FrontierSafetyError("no fresh promoted uncertainty calibration for domain")
        artifact = sorted(
            candidates,
            key=lambda row: (parse_time(row.calibrated_at), row.version, row.fingerprint),
            reverse=True,
        )[0]
        result = artifact.calibrate(
            confidence,
            at,
            current_confidences=current_confidences,
            maximum_drift_psi=maximum_drift_psi,
        )
        result["registry_sha256"] = self.fingerprint
        return result


@dataclass(frozen=True)
class IntervalCoverageObservation:
    observation_id: str
    domain: str
    lower: float
    upper: float
    realized: float
    alpha: float
    observed_at: str
    provenance_hash: str

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip() for value in (self.observation_id, self.domain)):
            raise ValueError("interval observation identity required")
        values = tuple(float(x) for x in (self.lower, self.upper, self.realized, self.alpha))
        if not all(math.isfinite(value) for value in values):
            raise ValueError("interval observations must be finite")
        if values[0] > values[1]:
            raise ValueError("interval lower bound exceeds upper bound")
        if not 0.0 < values[3] < 1.0:
            raise ValueError("alpha must be in (0,1)")
        parse_time(self.observed_at)
        if not _valid_sha256(self.provenance_hash):
            raise ValueError("interval provenance_hash must be SHA-256")


class IntervalCoverageGate:
    @staticmethod
    def evaluate(
        observations: Sequence[IntervalCoverageObservation],
        *,
        domain: str,
        alpha: float,
        minimum_samples: int = 30,
        maximum_coverage_shortfall: float = 0.03,
    ) -> dict[str, Any]:
        if not isinstance(domain, str) or not domain.strip():
            raise ValueError("interval coverage domain required")
        alpha_value = float(alpha)
        maximum_shortfall = float(maximum_coverage_shortfall)
        if not math.isfinite(alpha_value) or not 0.0 < alpha_value < 1.0:
            raise ValueError("interval coverage alpha must be finite and in (0,1)")
        if not isinstance(minimum_samples, int) or isinstance(minimum_samples, bool) or minimum_samples <= 0:
            raise ValueError("minimum_samples must be a positive integer")
        if not math.isfinite(maximum_shortfall) or not 0.0 <= maximum_shortfall <= 1.0:
            raise ValueError("maximum_coverage_shortfall must be finite and in [0,1]")
        rows = [row for row in observations if row.domain == domain]
        if len(rows) < minimum_samples:
            return {"status": "FAIL", "reason": "insufficient_interval_holdout_samples", "n": len(rows)}
        if any(not math.isclose(row.alpha, alpha_value, rel_tol=0.0, abs_tol=1e-12) for row in rows):
            raise FrontierSafetyError("mixed interval alpha values")
        if len({row.observation_id for row in rows}) != len(rows):
            raise FrontierSafetyError("duplicate interval observation id")
        provenance = [row.provenance_hash for row in rows]
        if len(set(provenance)) != len(provenance):
            raise FrontierSafetyError("duplicate interval provenance record")
        covered = sum(1 for row in rows if row.lower <= row.realized <= row.upper)
        coverage = covered / len(rows)
        target = 1.0 - alpha_value
        average_width = sum(row.upper - row.lower for row in rows) / len(rows)
        shortfall = max(0.0, target - coverage)
        return {
            "status": "PASS" if shortfall <= maximum_shortfall else "FAIL",
            "domain": domain,
            "alpha": alpha_value,
            "target_coverage": target,
            "empirical_coverage": coverage,
            "coverage_shortfall": shortfall,
            "average_width": average_width,
            "n": len(rows),
            "evidence_sha256": sha256([asdict(row) for row in sorted(rows, key=lambda x: x.observation_id)]),
        }
