from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import math

from .core import FrontierSafetyError, parse_time, sha256
from .evidence_resolution import SourceQualityProfile


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
        if not all((self.observation_id, self.source_id, self.source_group, self.domain)):
            raise ValueError("source-quality observation identity fields are required")
        if self.split not in {"train", "validation"}:
            raise ValueError("split must be train or validation")
        parse_time(self.observed_at)
        if len(self.provenance_hash) != 64:
            raise ValueError("observation provenance_hash must be SHA-256")


@dataclass(frozen=True)
class SourceCalibrationMetric:
    domain: str
    validation_count: int
    brier: float
    heuristic_brier: float
    calibration_gain: float
    authorized: bool


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
        if len(self.corpus_hash) != 64:
            raise ValueError("calibration corpus hash must be SHA-256")
        if set(self.train_groups) & set(self.validation_groups):
            raise FrontierSafetyError("source-group leakage between train and validation")

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
        return sum((float(p) - int(y)) ** 2 for p, y in zip(predictions, outcomes)) / len(predictions)

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
        if not version or minimum_train <= 0 or minimum_validation <= 0:
            raise ValueError("version and positive sample thresholds required")
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
            if len(rows) < minimum_validation:
                authorized = False
                brier = cls._brier(predictions, outcomes)
                baseline = cls._brier(heuristic, outcomes)
            else:
                brier = cls._brier(predictions, outcomes)
                baseline = cls._brier(heuristic, outcomes)
                authorized = brier <= baseline + maximum_brier_regression
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
