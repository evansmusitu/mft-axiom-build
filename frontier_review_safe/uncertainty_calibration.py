from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence
import math

from .core import FrontierSafetyError, parse_time, sha256


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
        if not all((self.observation_id, self.domain, self.independence_group)):
            raise ValueError("calibration observation identity fields are required")
        if self.split not in {"calibration", "holdout"}:
            raise ValueError("split must be calibration or holdout")
        if not 0.0 <= float(self.predicted_confidence) <= 1.0:
            raise ValueError("predicted_confidence must be in [0,1]")
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
        if not (0.0 <= self.lower < self.upper <= 1.0):
            raise ValueError("invalid calibration bin bounds")
        if self.count < 0 or self.correct_count < 0 or self.correct_count > self.count:
            raise ValueError("invalid calibration bin counts")
        if not 0.0 <= self.calibrated_confidence <= 1.0:
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

    def __post_init__(self) -> None:
        if self.schema != "musitu.axiom.domain-probability-calibration.v1":
            raise ValueError("unsupported uncertainty calibration schema")
        if not self.version or not self.domain:
            raise ValueError("calibration version and domain are required")
        start = parse_time(self.calibrated_at)
        end = parse_time(self.valid_until)
        if end <= start:
            raise ValueError("valid_until must be after calibrated_at")
        if not _valid_sha256(self.corpus_hash):
            raise ValueError("calibration corpus_hash must be SHA-256")
        if not self.bins or len(self.bins) != len(self.reference_histogram):
            raise ValueError("calibration bins and reference histogram must align")
        if self.calibration_count <= 0 or self.holdout_count <= 0:
            raise ValueError("calibration and holdout samples are required")
        if set(self.calibration_groups) & set(self.holdout_groups):
            raise FrontierSafetyError("independence-group leakage between calibration and holdout")
        if any(x < 0.0 for x in (self.holdout_raw_brier, self.holdout_calibrated_brier, self.holdout_ece)):
            raise ValueError("calibration metrics cannot be negative")
        if not math.isclose(sum(self.reference_histogram), 1.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("reference histogram must sum to one")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    def _bin_index(self, confidence: float) -> int:
        if not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence must be in [0,1]")
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
        if maximum_drift_psi < 0:
            raise ValueError("maximum_drift_psi cannot be negative")
        drift = None
        if current_confidences is not None:
            drift = self.drift_psi(current_confidences)
            if drift > maximum_drift_psi:
                raise FrontierSafetyError("domain uncertainty calibration drift exceeds limit")
        index = self._bin_index(float(confidence))
        row = self.bins[index]
        return {
            "status": "CALIBRATED",
            "domain": self.domain,
            "version": self.version,
            "raw_confidence": float(confidence),
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
        return sum(
            (max(epsilon, cur) - max(epsilon, ref))
            * math.log(max(epsilon, cur) / max(epsilon, ref))
            for ref, cur in zip(self.reference_histogram, current)
        )


class DomainProbabilityCalibrator:
    @staticmethod
    def _brier(probabilities: Sequence[float], outcomes: Sequence[int]) -> float:
        if not probabilities or len(probabilities) != len(outcomes):
            raise ValueError("equal non-empty probabilities/outcomes required")
        return sum((float(p) - int(y)) ** 2 for p, y in zip(probabilities, outcomes)) / len(probabilities)

    @staticmethod
    def _ece(probabilities: Sequence[float], outcomes: Sequence[int], bin_count: int) -> float:
        groups: list[list[tuple[float, int]]] = [[] for _ in range(bin_count)]
        for probability, outcome in zip(probabilities, outcomes):
            index = min(bin_count - 1, int(float(probability) * bin_count))
            groups[index].append((float(probability), int(outcome)))
        total = len(probabilities)
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
        if not version or bin_count < 2 or minimum_calibration <= 0 or minimum_holdout <= 0:
            raise ValueError("valid version, bins and sample thresholds required")
        if maximum_brier_regression < 0 or not 0.0 <= maximum_holdout_ece <= 1.0:
            raise ValueError("invalid calibration promotion thresholds")

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
            calibrated_brier <= raw_brier + maximum_brier_regression
            and ece <= maximum_holdout_ece
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
            maximum_holdout_ece,
            tuple(sorted(calibration_groups)),
            tuple(sorted(holdout_groups)),
            promoted,
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
        if not self.observation_id or not self.domain:
            raise ValueError("interval observation identity required")
        if not all(math.isfinite(float(x)) for x in (self.lower, self.upper, self.realized, self.alpha)):
            raise ValueError("interval observations must be finite")
        if self.lower > self.upper:
            raise ValueError("interval lower bound exceeds upper bound")
        if not 0.0 < self.alpha < 1.0:
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
        rows = [row for row in observations if row.domain == domain]
        if len(rows) < minimum_samples:
            return {"status": "FAIL", "reason": "insufficient_interval_holdout_samples", "n": len(rows)}
        if any(not math.isclose(row.alpha, alpha, rel_tol=0.0, abs_tol=1e-12) for row in rows):
            raise FrontierSafetyError("mixed interval alpha values")
        if len({row.observation_id for row in rows}) != len(rows):
            raise FrontierSafetyError("duplicate interval observation id")
        provenance = [row.provenance_hash for row in rows]
        if len(set(provenance)) != len(provenance):
            raise FrontierSafetyError("duplicate interval provenance record")
        covered = sum(1 for row in rows if row.lower <= row.realized <= row.upper)
        coverage = covered / len(rows)
        target = 1.0 - alpha
        average_width = sum(row.upper - row.lower for row in rows) / len(rows)
        shortfall = max(0.0, target - coverage)
        return {
            "status": "PASS" if shortfall <= maximum_coverage_shortfall else "FAIL",
            "domain": domain,
            "alpha": alpha,
            "target_coverage": target,
            "empirical_coverage": coverage,
            "coverage_shortfall": shortfall,
            "average_width": average_width,
            "n": len(rows),
            "evidence_sha256": sha256([asdict(row) for row in sorted(rows, key=lambda x: x.observation_id)]),
        }


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )
