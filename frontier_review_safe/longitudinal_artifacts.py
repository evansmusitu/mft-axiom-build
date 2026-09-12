from __future__ import annotations

from collections.abc import Mapping as MappingABC, Sequence as SequenceABC
from typing import Any, Mapping
import math

from .core import parse_time, sha256


FAILURE_CORPUS_SCHEMA = "musitu.axiom.retained-failure-corpus.v1"
DRIFT_REPORT_SCHEMA = "musitu.axiom.longitudinal-drift-report.v1"
REPLACEMENT_GOVERNANCE_SCHEMA = "musitu.axiom.replacement-governance.v1"
DRIFT_ASSESSMENTS = frozenset({"STABLE", "IMPROVED", "DRIFT_DETECTED", "INCONCLUSIVE"})
REPLACEMENT_DECISIONS = frozenset({"KEEP_CURRENT", "PROMOTE_REPLACEMENT", "ROLLBACK", "RETIRE", "DEFER"})


def _valid_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value.lower())
    )


def _valid_git_sha(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(char in "0123456789abcdef" for char in value.lower())
    )


def _nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _mapping(value: Any) -> Mapping[str, Any] | None:
    if not isinstance(value, MappingABC):
        return None
    try:
        return dict(value)
    except Exception:
        return None


def _sequence(value: Any) -> list[Any] | None:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, SequenceABC):
        return None
    try:
        return list(value)
    except Exception:
        return None


def _identity_reasons(
    artifact: Mapping[str, Any],
    *,
    schema: str,
    refresh_id: str,
    executed_at: str,
    candidate_sha: str,
    case_set_hash: str,
    prefix: str,
) -> list[str]:
    reasons: list[str] = []
    if artifact.get("schema") != schema:
        reasons.append(f"{prefix}_schema_invalid")
    if artifact.get("refresh_id") != refresh_id:
        reasons.append(f"{prefix}_refresh_identity_mismatch")
    if artifact.get("executed_at") != executed_at:
        reasons.append(f"{prefix}_execution_time_mismatch")
    if artifact.get("candidate_sha") != candidate_sha or not _valid_git_sha(artifact.get("candidate_sha")):
        reasons.append(f"{prefix}_candidate_identity_mismatch")
    if artifact.get("case_set_hash") != case_set_hash or not _valid_sha256(artifact.get("case_set_hash")):
        reasons.append(f"{prefix}_case_set_identity_mismatch")
    try:
        if parse_time(str(artifact.get("executed_at"))) != parse_time(executed_at):
            reasons.append(f"{prefix}_execution_time_invalid")
    except (TypeError, ValueError):
        reasons.append(f"{prefix}_execution_time_invalid")
    return reasons


def _validate_failure_corpus(
    artifact: Mapping[str, Any],
    *,
    refresh_id: str,
    executed_at: str,
    candidate_sha: str,
    case_set_hash: str,
) -> list[str]:
    reasons = _identity_reasons(
        artifact,
        schema=FAILURE_CORPUS_SCHEMA,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
        prefix="retained_failure_corpus",
    )
    evaluated_case_count = artifact.get("evaluated_case_count")
    if (
        not isinstance(evaluated_case_count, int)
        or isinstance(evaluated_case_count, bool)
        or evaluated_case_count < 1
    ):
        reasons.append("retained_failure_corpus_evaluated_case_count_invalid")

    source_hashes = _sequence(artifact.get("source_evidence_hashes"))
    if not source_hashes or any(not _valid_sha256(value) for value in source_hashes):
        reasons.append("retained_failure_corpus_source_evidence_invalid")
    elif len(set(source_hashes)) != len(source_hashes):
        reasons.append("retained_failure_corpus_source_evidence_duplicate")

    failures = _sequence(artifact.get("failures"))
    if failures is None:
        reasons.append("retained_failure_corpus_failures_invalid")
        return reasons
    seen_ids: set[str] = set()
    seen_cases: set[str] = set()
    refresh_time = parse_time(executed_at)
    for row in failures:
        failure = _mapping(row)
        if failure is None:
            reasons.append("retained_failure_corpus_entry_invalid")
            continue
        failure_id = failure.get("failure_id")
        case_fingerprint = failure.get("case_fingerprint")
        if not _nonblank(failure_id):
            reasons.append("retained_failure_corpus_failure_identity_invalid")
        elif failure_id in seen_ids:
            reasons.append("retained_failure_corpus_failure_identity_duplicate")
        else:
            seen_ids.add(failure_id)
        if not _valid_sha256(case_fingerprint):
            reasons.append("retained_failure_corpus_case_fingerprint_invalid")
        elif case_fingerprint in seen_cases:
            reasons.append("retained_failure_corpus_case_fingerprint_duplicate")
        else:
            seen_cases.add(case_fingerprint)
        occurrences = failure.get("occurrences")
        if not isinstance(occurrences, int) or isinstance(occurrences, bool) or occurrences < 1:
            reasons.append("retained_failure_corpus_occurrences_invalid")
        if failure.get("retained") is not True:
            reasons.append("retained_failure_corpus_retention_not_confirmed")
        try:
            first_seen = parse_time(str(failure.get("first_seen_at")))
            last_seen = parse_time(str(failure.get("last_seen_at")))
            if first_seen > last_seen or last_seen > refresh_time:
                reasons.append("retained_failure_corpus_chronology_invalid")
        except (TypeError, ValueError):
            reasons.append("retained_failure_corpus_chronology_invalid")
    if isinstance(evaluated_case_count, int) and not isinstance(evaluated_case_count, bool):
        if len(failures) > evaluated_case_count:
            reasons.append("retained_failure_corpus_failure_count_exceeds_evaluated_cases")
    return reasons


def _validate_drift_report(
    artifact: Mapping[str, Any],
    *,
    refresh_id: str,
    executed_at: str,
    candidate_sha: str,
    case_set_hash: str,
    failure_source_hashes: set[str],
) -> list[str]:
    reasons = _identity_reasons(
        artifact,
        schema=DRIFT_REPORT_SCHEMA,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
        prefix="drift_report",
    )
    baseline_hash = artifact.get("baseline_evidence_hash")
    current_hash = artifact.get("current_evidence_hash")
    if not _valid_sha256(baseline_hash) or not _valid_sha256(current_hash):
        reasons.append("drift_report_source_evidence_invalid")
    elif baseline_hash == current_hash:
        reasons.append("drift_report_sources_not_distinct")
    if _valid_sha256(current_hash) and current_hash not in failure_source_hashes:
        reasons.append("drift_report_current_evidence_not_bound_to_failure_corpus")

    observations = _sequence(artifact.get("observations"))
    if not observations:
        reasons.append("drift_report_observations_missing")
    else:
        seen_metrics: set[str] = set()
        for row in observations:
            observation = _mapping(row)
            if observation is None:
                reasons.append("drift_report_observation_invalid")
                continue
            metric = observation.get("metric")
            if not _nonblank(metric):
                reasons.append("drift_report_metric_identity_invalid")
            elif metric in seen_metrics:
                reasons.append("drift_report_metric_identity_duplicate")
            else:
                seen_metrics.add(metric)
            for key in ("baseline_value", "current_value"):
                try:
                    numeric = float(observation.get(key))
                except (TypeError, ValueError):
                    reasons.append("drift_report_metric_value_invalid")
                    continue
                if not math.isfinite(numeric):
                    reasons.append("drift_report_metric_value_invalid")
            if observation.get("assessment") not in DRIFT_ASSESSMENTS:
                reasons.append("drift_report_assessment_invalid")
    if artifact.get("conclusion") not in DRIFT_ASSESSMENTS:
        reasons.append("drift_report_conclusion_invalid")
    return reasons


def _validate_replacement_governance(
    artifact: Mapping[str, Any],
    *,
    refresh_id: str,
    executed_at: str,
    candidate_sha: str,
    case_set_hash: str,
    failure_hash: str,
    drift_hash: str,
) -> list[str]:
    reasons = _identity_reasons(
        artifact,
        schema=REPLACEMENT_GOVERNANCE_SCHEMA,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
        prefix="replacement_governance",
    )
    decision = artifact.get("decision")
    if decision not in REPLACEMENT_DECISIONS:
        reasons.append("replacement_governance_decision_invalid")
    if not _nonblank(artifact.get("decision_maker_id")):
        reasons.append("replacement_governance_decision_maker_invalid")
    if not _valid_sha256(artifact.get("reason_hash")):
        reasons.append("replacement_governance_reason_hash_invalid")
    if not _nonblank(artifact.get("current_version")):
        reasons.append("replacement_governance_current_version_invalid")
    target_version = artifact.get("target_version")
    if decision in {"PROMOTE_REPLACEMENT", "ROLLBACK"}:
        if not _nonblank(target_version) or target_version == artifact.get("current_version"):
            reasons.append("replacement_governance_target_version_invalid")
    elif target_version is not None and not _nonblank(target_version):
        reasons.append("replacement_governance_target_version_invalid")

    evidence_hashes = _sequence(artifact.get("evidence_hashes"))
    if not evidence_hashes or any(not _valid_sha256(value) for value in evidence_hashes):
        reasons.append("replacement_governance_evidence_invalid")
    else:
        evidence_set = set(evidence_hashes)
        if len(evidence_set) != len(evidence_hashes):
            reasons.append("replacement_governance_evidence_duplicate")
        if failure_hash not in evidence_set:
            reasons.append("replacement_governance_failure_corpus_not_bound")
        if drift_hash not in evidence_set:
            reasons.append("replacement_governance_drift_report_not_bound")
    return reasons


def validate_longitudinal_artifact_bundle(
    refresh: Any,
    bundle: Any,
) -> dict[str, Any]:
    """Validate Level-7 artifact contents and bind them to the attested refresh.

    No calendar-duration or performance threshold is invented here. This verifier
    checks identity, chronology, content shape, cross-artifact provenance and the
    exact hashes already declared by the longitudinal refresh record.
    """
    mapping = _mapping(bundle)
    if mapping is None:
        return {"status": "FAIL", "reasons": ["longitudinal_semantic_artifact_bundle_missing"]}

    required = {
        "retained_failure_corpus": getattr(refresh, "retained_failure_corpus_hash", None),
        "drift_report": getattr(refresh, "drift_report_hash", None),
        "replacement_governance": getattr(refresh, "replacement_governance_hash", None),
    }
    artifacts: dict[str, Mapping[str, Any]] = {}
    reasons: list[str] = []
    for name, declared_hash in required.items():
        artifact = _mapping(mapping.get(name))
        if artifact is None:
            reasons.append(f"{name}_semantic_artifact_missing")
            continue
        artifacts[name] = artifact
        actual_hash = sha256(artifact)
        if not _valid_sha256(declared_hash) or actual_hash != declared_hash:
            reasons.append(f"{name}_hash_mismatch")

    if len(artifacts) != 3:
        return {"status": "FAIL", "reasons": sorted(set(reasons))}

    refresh_id = getattr(refresh, "refresh_id", "")
    executed_at = getattr(refresh, "executed_at", "")
    candidate_sha = getattr(refresh, "candidate_sha", "")
    case_set_hash = getattr(refresh, "case_set_hash", "")

    failure = artifacts["retained_failure_corpus"]
    drift = artifacts["drift_report"]
    governance = artifacts["replacement_governance"]
    reasons.extend(_validate_failure_corpus(
        failure,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
    ))
    failure_sources = _sequence(failure.get("source_evidence_hashes")) or []
    failure_source_hashes = {value for value in failure_sources if _valid_sha256(value)}
    reasons.extend(_validate_drift_report(
        drift,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
        failure_source_hashes=failure_source_hashes,
    ))
    failure_hash = sha256(failure)
    drift_hash = sha256(drift)
    reasons.extend(_validate_replacement_governance(
        governance,
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=candidate_sha,
        case_set_hash=case_set_hash,
        failure_hash=failure_hash,
        drift_hash=drift_hash,
    ))
    unique_reasons = sorted(set(reasons))
    return {
        "status": "PASS" if not unique_reasons else "FAIL",
        "reasons": unique_reasons,
        "artifact_hashes": {
            "retained_failure_corpus": failure_hash,
            "drift_report": drift_hash,
            "replacement_governance": sha256(governance),
        },
    }
