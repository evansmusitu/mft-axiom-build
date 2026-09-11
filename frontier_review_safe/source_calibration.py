from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import math

from .core import FrontierSafetyError, parse_time, sha256
from .evidence_resolution import SourceQualityProfile


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


@dataclass(frozen=True)
class SourceQualityObservation:
    observation_id: str
    source_id: str
    source_group: str
    domain: str
    split: str
    observed_at: str
    authoritative: bool
    methodologically_sound: bool
    provenance_intact: bool
    corrected_or_retracted: bool
    outcome_correct: bool
    provenance_hash: str

    def __post_init__(self) -> None:
        identity = (self.observation_id, self.source_id, self.source_group, self.domain)
        if any(not isinstance(value, str) or not value.strip() for value in identity):
            raise ValueError("source-quality observation identity fields are required")
        if self.split not in {"train", "validation"}:
            raise ValueError("split must be train or validation")
        parse_time(self.observed_at)
        if not _valid_sha256(self.provenance_hash):
            raise ValueError("observation provenance_hash must be SHA-256")


@dataclass(frozen=True)
class SourceCalibrationMetric:
    domain: str
    validation_count: int
    brier: float
    heuristic_brier: float
    calibration_gain: float
    authorized: bool

    def __post_init__(self) -> None:
        if not isinstance(self.domain, str) or not self.domain.strip():
            raise ValueError("calibration metric domain required")
        if not isinstance(self.validation_count, int) or isinstance(self.validation_count, bool) or self.validation_count <= 0:
            raise ValueError("calibration validation_count must be a positive integer")
        values = (float(self.brier), float(self.heuristic_brier), float(self.calibration_gain))
        if any(not math.isfinite(value) for value in values):
            raise ValueError("calibration metrics must be finite")
        if not 0.0 <= float(self.brier) <= 1.0 or not 0.0 <= float(self.heuristic_brier) <= 1.0:
            raise ValueError("Brier scores must be within [0,1]")
        if not isinstance(self.authorized, bool):
            raise ValueError("calibration authorization must be boolean")


@dataclass(frozen=True)
class SourceQualityCalibrationArtifact:
    schema: str
    version: str
    trained_at: str
    corpus_hash: str
    profiles: tuple[tuple[str, str, SourceQualityProfile], ...]
    metrics: tuple[SourceCalibrationMetric, ...]
    train_groups: tuple[str, ...]
    validation_groups: tuple[str, ...]
    promotion_authorized: bool

    def __post_init__(self) -> None:
        parse_time(self.trained_at)
        if self.schema != "musitu.axiom.source-quality-calibration.v1":
            raise ValueError("unsupported source-quality calibration schema")
        if not isinstance(self.version, str) or not self.version.strip():
            raise ValueError("calibration version required")
        if not _valid_sha256(self.corpus_hash):
            raise ValueError("calibration corpus hash must be SHA-256")
        if not self.profiles or not self.metrics:
            raise ValueError("calibration artifact requires profiles and holdout metrics")
        if any(not isinstance(group, str) or not group.strip() for group in (*self.train_groups, *self.validation_groups)):
            raise ValueError("calibration source groups must be non-empty strings")
        if len(self.train_groups) != len(set(self.train_groups)) or len(self.validation_groups) != len(set(self.validation_groups)):
            raise ValueError("duplicate calibration source group")
        if set(self.train_groups) & set(self.validation_groups):
            raise FrontierSafetyError("source-group leakage between train and validation")
        if not isinstance(self.promotion_authorized, bool):
            raise ValueError("promotion_authorized must be boolean")
        if self.promotion_authorized and not all(metric.authorized for metric in self.metrics):
            raise FrontierSafetyError("promoted calibration artifact contains unauthorized holdout metric")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))

    def profiles_for_domain(self, domain: str, *, require_promoted: bool = True) -> dict[str, SourceQualityProfile]:
        if require_promoted and not self.promotion_authorized:
            raise FrontierSafetyError("source-quality calibration artifact is not promoted")
        out = {source_id: profile for source_id, d, profile in self.profiles if d == domain}
        if not out:
            raise FrontierSafetyError(f"no calibrated source profiles for domain: {domain}")
        return out


class SourceQualityCalibrator:
    """Build domain-specific source profiles from leakage-separated historical observations.

    Calibration is intentionally simple and auditable: a source profile is computed
    only from training observations for that source/domain. Promotion is determined
    on source groups held out from profile construction, so repeated observations
    from the same publisher/provider family cannot leak across train/validation.
    """

    @staticmethod
    def _brier(predictions: Sequence[float], outcomes: Sequence[int]) -> float:
        if not predictions or len(predictions) != len(outcomes):
            raise ValueError("equal non-empty predictions/outcomes required")
        values = [float(p) for p in predictions]
        labels = [int(y) for y in outcomes]
        if any(not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in values):
            raise ValueError("calibration probabilities must be finite and within [0,1]")
        if any(label not in {0, 1} for label in labels):
            raise ValueError("calibration outcomes must be binary")
        return sum((p - y) ** 2 for p, y in zip(values, labels)) / len(values)

    @staticmethod
    def _profile(rows: Sequence[SourceQualityObservation]) -> SourceQualityProfile:
        if not rows:
            raise ValueError("training rows required")
        n = len(rows)
        domain_expertise = sum(1.0 if r.authoritative and r.methodologically_sound else 0.0 for r in rows) / n
        historical_calibration = sum(1.0 if r.outcome_correct else 0.0 for r in rows) / n
        correction_history_risk = sum(1.0 if r.corrected_or_retracted else 0.0 for r in rows) / n
        return SourceQualityProfile(
            rows[0].source_id,
            domain_expertise=domain_expertise,
            historical_calibration=historical_calibration,
            correction_history_risk=correction_history_risk,
        )

    @staticmethod
    def _predict(profile: SourceQualityProfile) -> float:
        # Profile-only reliability probability used strictly for holdout calibration.
        positive = 0.45 * profile.historical_calibration + 0.35 * profile.domain_expertise + 0.20 * (1.0 - profile.correction_history_risk)
        return max(0.0, min(1.0, positive))

    @classmethod
    def fit(
        cls,
        observations: Sequence[SourceQualityObservation],
        *,
        version: str,
        trained_at: str,
        minimum_train: int = 8,
        minimum_validation: int = 4,
        maximum_brier_regression: float = 0.0,
    ) -> SourceQualityCalibrationArtifact:
        parse_time(trained_at)
        if not isinstance(version, str) or not version.strip():
            raise ValueError("calibration version required")
        for name, value in (("minimum_train", minimum_train), ("minimum_validation", minimum_validation)):
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        try:
            maximum_regression = float(maximum_brier_regression)
        except (TypeError, ValueError) as exc:
            raise ValueError("maximum_brier_regression must be a finite non-negative number") from exc
        if not math.isfinite(maximum_regression) or maximum_regression < 0.0:
            raise ValueError("maximum_brier_regression must be a finite non-negative number")
        if not observations:
            raise ValueError("calibration observations required")
        ids = [r.observation_id for r in observations]
        if len(ids) != len(set(ids)):
            raise FrontierSafetyError("duplicate source-quality observation id")
        provenance = [r.provenance_hash for r in observations]
        if len(provenance) != len(set(provenance)):
            raise FrontierSafetyError("duplicate calibration provenance record")
        train_groups = {r.source_group for r in observations if r.split == "train"}
        validation_groups = {r.source_group for r in observations if r.split == "validation"}
        if train_groups & validation_groups:
            raise FrontierSafetyError("source-group leakage between train and validation")

        train = [r for r in observations if r.split == "train"]
        validation = [r for r in observations if r.split == "validation"]
        if len(train) < minimum_train or len(validation) < minimum_validation:
            raise FrontierSafetyError("insufficient leakage-separated calibration samples")

        by_source_domain: dict[tuple[str, str], list[SourceQualityObservation]] = {}
        for row in train:
            by_source_domain.setdefault((row.source_id, row.domain), []).append(row)
        profiles = tuple(
            (source_id, domain, cls._profile(rows))
            for (source_id, domain), rows in sorted(by_source_domain.items())
        )
        profile_map = {(source_id, domain): profile for source_id, domain, profile in profiles}

        metrics: list[SourceCalibrationMetric] = []
        domains = sorted({r.domain for r in validation})
        all_authorized = True
        for domain in domains:
            rows = [r for r in validation if r.domain == domain]
            predictions: list[float] = []
            outcomes: list[int] = []
            heuristic: list[float] = []
            for row in rows:
                profile = profile_map.get((row.source_id, domain))
                if profile is None:
                    # A genuinely unseen source must not inherit another source's reputation.
                    predictions.append(0.5)
                else:
                    predictions.append(cls._predict(profile))
                outcomes.append(1 if row.outcome_correct and row.provenance_intact else 0)
                heuristic.append(0.5)
            brier = cls._brier(predictions, outcomes)
            baseline = cls._brier(heuristic, outcomes)
            authorized = len(rows) >= minimum_validation and brier <= baseline + maximum_regression
            all_authorized = all_authorized and authorized
            metrics.append(SourceCalibrationMetric(domain, len(rows), brier, baseline, baseline - brier, authorized))

        corpus_hash = sha256([asdict(r) for r in sorted(observations, key=lambda x: x.observation_id)])
        return SourceQualityCalibrationArtifact(
            "musitu.axiom.source-quality-calibration.v1",
            version,
            trained_at,
            corpus_hash,
            profiles,
            tuple(metrics),
            tuple(sorted(train_groups)),
            tuple(sorted(validation_groups)),
            bool(metrics) and all_authorized,
        )
