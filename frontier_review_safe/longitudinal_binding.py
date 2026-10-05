from __future__ import annotations

from collections.abc import Mapping as MappingABC
from dataclasses import dataclass
from typing import Any, Mapping
import hashlib
import json
import math

from .core import parse_time, sha256


RETAINED_FAILURE_CORPUS_SCHEMA = "musitu.axiom.retained-failure-corpus.v1"
DRIFT_REPORT_SCHEMA = "musitu.axiom.drift-report.v1"
REPLACEMENT_GOVERNANCE_SCHEMA = "musitu.axiom.replacement-governance.v1"

_FAILURE_STATUSES = frozenset({"open", "mitigated", "resolved", "regressed"})
_GOVERNANCE_DECISIONS = frozenset({"retain", "replace", "rollback", "investigate"})


def valid_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def valid_git_sha(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def artifact_sha256(text: str) -> str:
    if not isinstance(text, str):
        raise ValueError("longitudinal artifact content must be UTF-8 text")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parse_time(value)
    except (TypeError, ValueError):
        return False
    return True


def _finite_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _json_object(text: str) -> dict[str, Any] | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        value = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(value, MappingABC):
        return None
    try:
        return dict(value)
    except Exception:
        return None


def _identity_reasons(
    document: Mapping[str, Any],
    *,
    prefix: str,
    schema: str,
    candidate_sha: str,
    case_set_hash: str,
) -> list[str]:
    reasons: list[str] = []
    if document.get("schema") != schema:
        reasons.append(f"{prefix}_schema_invalid")
    if document.get("candidate_sha") != candidate_sha or document.get("case_set_hash") != case_set_hash:
        reasons.append(f"{prefix}_identity_mismatch")
    if not _timestamp(document.get("generated_at")):
        reasons.append(f"{prefix}_generated_at_invalid")
    return reasons


@dataclass(frozen=True)
class LongitudinalArtifactBundle:
    retained_failure_corpus_json: str
    drift_report_json: str
    replacement_governance_json: str

    def __post_init__(self) -> None:
        for value in (
            self.retained_failure_corpus_json,
            self.drift_report_json,
            self.replacement_governance_json,
        ):
            if not isinstance(value, str) or not value:
                raise ValueError("longitudinal artifact bundle requires non-empty UTF-8 JSON text")

    @property
    def fingerprint(self) -> str:
        return sha256({
            "retained_failure_corpus_hash": artifact_sha256(self.retained_failure_corpus_json),
            "drift_report_hash": artifact_sha256(self.drift_report_json),
            "replacement_governance_hash": artifact_sha256(self.replacement_governance_json),
        })

    def verify(
        self,
        *,
        candidate_sha: str,
        case_set_hash: str,
        baseline_registry_hash: str,
        retained_failure_corpus_hash: str,
        drift_report_hash: str,
        replacement_governance_hash: str,
    ) -> dict[str, Any]:
        reasons: list[str] = []
        actual_hashes = {
            "retained_failure_corpus_hash": artifact_sha256(self.retained_failure_corpus_json),
            "drift_report_hash": artifact_sha256(self.drift_report_json),
            "replacement_governance_hash": artifact_sha256(self.replacement_governance_json),
        }
        expected_hashes = {
            "retained_failure_corpus_hash": retained_failure_corpus_hash,
            "drift_report_hash": drift_report_hash,
            "replacement_governance_hash": replacement_governance_hash,
        }
        for key, actual in actual_hashes.items():
            if actual != expected_hashes[key]:
                reasons.append(f"{key}_mismatch")

        corpus = _json_object(self.retained_failure_corpus_json)
        if corpus is None:
            reasons.append("retained_failure_corpus_json_invalid")
        else:
            reasons.extend(_identity_reasons(
                corpus,
                prefix="retained_failure_corpus",
                schema=RETAINED_FAILURE_CORPUS_SCHEMA,
                candidate_sha=candidate_sha,
                case_set_hash=case_set_hash,
            ))
            failures = corpus.get("failures")
            if not isinstance(failures, list):
                reasons.append("retained_failure_corpus_failures_invalid")
            else:
                seen_failure_ids: set[str] = set()
                for item in failures:
                    if not isinstance(item, MappingABC):
                        reasons.append("retained_failure_corpus_failure_record_invalid")
                        continue
                    failure = dict(item)
                    failure_id = failure.get("failure_id")
                    if not _nonblank(failure_id) or failure_id in seen_failure_ids:
                        reasons.append("retained_failure_corpus_failure_identity_invalid")
                    else:
                        seen_failure_ids.add(failure_id)
                    if not valid_sha256(failure.get("case_fingerprint")):
                        reasons.append("retained_failure_corpus_case_fingerprint_invalid")
                    if failure.get("status") not in _FAILURE_STATUSES:
                        reasons.append("retained_failure_corpus_status_invalid")
                    occurrences = failure.get("occurrences")
                    if not isinstance(occurrences, int) or isinstance(occurrences, bool) or occurrences < 1:
                        reasons.append("retained_failure_corpus_occurrences_invalid")
                    if not valid_sha256(failure.get("evidence_hash")):
                        reasons.append("retained_failure_corpus_evidence_hash_invalid")
                    first_seen = failure.get("first_seen_at")
                    last_seen = failure.get("last_seen_at")
                    if not _timestamp(first_seen) or not _timestamp(last_seen):
                        reasons.append("retained_failure_corpus_time_invalid")
                    elif parse_time(last_seen) < parse_time(first_seen):
                        reasons.append("retained_failure_corpus_time_reversal")

        drift = _json_object(self.drift_report_json)
        if drift is None:
            reasons.append("drift_report_json_invalid")
        else:
            reasons.extend(_identity_reasons(
                drift,
                prefix="drift_report",
                schema=DRIFT_REPORT_SCHEMA,
                candidate_sha=candidate_sha,
                case_set_hash=case_set_hash,
            ))
            if drift.get("baseline_registry_hash") != baseline_registry_hash:
                reasons.append("drift_report_baseline_registry_mismatch")
            observations = drift.get("observations")
            breached_count = 0
            if not isinstance(observations, list):
                reasons.append("drift_report_observations_invalid")
                observations = []
            seen_metrics: set[str] = set()
            for item in observations:
                if not isinstance(item, MappingABC):
                    reasons.append("drift_report_observation_invalid")
                    continue
                observation = dict(item)
                metric = observation.get("metric")
                if not _nonblank(metric) or metric in seen_metrics:
                    reasons.append("drift_report_metric_identity_invalid")
                else:
                    seen_metrics.add(metric)
                numeric_fields = (
                    observation.get("baseline_value"),
                    observation.get("current_value"),
                    observation.get("delta"),
                    observation.get("threshold"),
                )
                if not all(_finite_number(value) for value in numeric_fields):
                    reasons.append("drift_report_numeric_value_invalid")
                    continue
                baseline_value = float(observation["baseline_value"])
                current_value = float(observation["current_value"])
                delta = float(observation["delta"])
                threshold = float(observation["threshold"])
                if threshold < 0.0:
                    reasons.append("drift_report_threshold_invalid")
                    continue
                if not math.isclose(
                    delta,
                    current_value - baseline_value,
                    rel_tol=1e-12,
                    abs_tol=1e-12,
                ):
                    reasons.append("drift_report_delta_inconsistent")
                breached = observation.get("breached")
                if not isinstance(breached, bool):
                    reasons.append("drift_report_breach_flag_invalid")
                else:
                    expected_breach = abs(delta) > threshold
                    if breached != expected_breach:
                        reasons.append("drift_report_breach_flag_inconsistent")
                    if breached:
                        breached_count += 1
                if not valid_sha256(observation.get("evidence_hash")):
                    reasons.append("drift_report_evidence_hash_invalid")
            expected_status = (
                "drift_detected" if breached_count > 0
                else "stable" if observations
                else "indeterminate"
            )
            if drift.get("overall_status") != expected_status:
                reasons.append("drift_report_overall_status_inconsistent")

        governance = _json_object(self.replacement_governance_json)
        if governance is None:
            reasons.append("replacement_governance_json_invalid")
        else:
            reasons.extend(_identity_reasons(
                governance,
                prefix="replacement_governance",
                schema=REPLACEMENT_GOVERNANCE_SCHEMA,
                candidate_sha=candidate_sha,
                case_set_hash=case_set_hash,
            ))
            decision = governance.get("decision")
            if decision not in _GOVERNANCE_DECISIONS:
                reasons.append("replacement_governance_decision_invalid")
            if not _nonblank(governance.get("decision_id")):
                reasons.append("replacement_governance_decision_identity_invalid")
            if not _nonblank(governance.get("rationale")):
                reasons.append("replacement_governance_rationale_missing")
            before_hash = governance.get("baseline_registry_hash_before")
            after_hash = governance.get("baseline_registry_hash_after")
            if not valid_sha256(before_hash) or not valid_sha256(after_hash):
                reasons.append("replacement_governance_baseline_hash_invalid")
            else:
                if after_hash != baseline_registry_hash:
                    reasons.append("replacement_governance_baseline_registry_mismatch")
                if decision in {"replace", "rollback"} and before_hash == after_hash:
                    reasons.append("replacement_governance_transition_missing")
                if decision in {"retain", "investigate"} and before_hash != after_hash:
                    reasons.append("replacement_governance_unapproved_transition")
            if not valid_sha256(governance.get("evidence_hash")):
                reasons.append("replacement_governance_evidence_hash_invalid")

        reasons = sorted(set(reasons))
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            **actual_hashes,
            "semantic_evidence_sha256": sha256(actual_hashes),
        }


@dataclass(frozen=True)
class LongitudinalIdentityBinding:
    candidate_sha: str
    case_set_hash: str

    def __post_init__(self) -> None:
        if not valid_git_sha(self.candidate_sha):
            raise ValueError("longitudinal candidate_sha must be an exact 40-hex Git SHA")
        if not valid_sha256(self.case_set_hash):
            raise ValueError("longitudinal case_set_hash must be SHA-256")

    @classmethod
    def from_level6(cls, level6: Mapping[str, Any]) -> "LongitudinalIdentityBinding":
        if not isinstance(level6, MappingABC):
            raise ValueError("level6 assessment must be a mapping")
        return cls(
            candidate_sha=level6.get("candidate_sha"),
            case_set_hash=level6.get("case_set_hash"),
        )

    def matches(self, *, candidate_sha: str, case_set_hash: str) -> bool:
        return candidate_sha == self.candidate_sha and case_set_hash == self.case_set_hash
