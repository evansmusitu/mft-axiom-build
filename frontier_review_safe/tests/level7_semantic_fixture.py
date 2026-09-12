from __future__ import annotations

from typing import Any

from frontier_review_safe.core import sha256
from frontier_review_safe.longitudinal_artifacts import (
    DRIFT_REPORT_SCHEMA,
    FAILURE_CORPUS_SCHEMA,
    REPLACEMENT_GOVERNANCE_SCHEMA,
)


def artifact_bundle_for(refresh: Any) -> dict[str, dict[str, Any]]:
    current_evidence_hash = sha256({
        "refresh_id": refresh.refresh_id,
        "executed_at": refresh.executed_at,
        "source": "current-sealed-evaluation",
    })
    baseline_evidence_hash = sha256({
        "refresh_id": refresh.refresh_id,
        "executed_at": refresh.executed_at,
        "source": "baseline-sealed-evaluation",
    })
    failure_corpus = {
        "schema": FAILURE_CORPUS_SCHEMA,
        "refresh_id": refresh.refresh_id,
        "executed_at": refresh.executed_at,
        "candidate_sha": refresh.candidate_sha,
        "case_set_hash": refresh.case_set_hash,
        "source_evidence_hashes": [current_evidence_hash],
        "evaluated_case_count": 8,
        "failures": [],
    }
    drift_report = {
        "schema": DRIFT_REPORT_SCHEMA,
        "refresh_id": refresh.refresh_id,
        "executed_at": refresh.executed_at,
        "candidate_sha": refresh.candidate_sha,
        "case_set_hash": refresh.case_set_hash,
        "baseline_evidence_hash": baseline_evidence_hash,
        "current_evidence_hash": current_evidence_hash,
        "observations": [
            {
                "metric": "sealed_score",
                "baseline_value": 0.71,
                "current_value": 0.73,
                "assessment": "IMPROVED",
            }
        ],
        "conclusion": "IMPROVED",
    }
    replacement_governance = {
        "schema": REPLACEMENT_GOVERNANCE_SCHEMA,
        "refresh_id": refresh.refresh_id,
        "executed_at": refresh.executed_at,
        "candidate_sha": refresh.candidate_sha,
        "case_set_hash": refresh.case_set_hash,
        "decision": "KEEP_CURRENT",
        "decision_maker_id": "independent-governance-reviewer",
        "reason_hash": sha256({"refresh_id": refresh.refresh_id, "decision": "KEEP_CURRENT"}),
        "current_version": refresh.candidate_sha,
        "target_version": None,
        "evidence_hashes": [sha256(failure_corpus), sha256(drift_report)],
    }
    return {
        "retained_failure_corpus": failure_corpus,
        "drift_report": drift_report,
        "replacement_governance": replacement_governance,
    }


def hashes_for_bundle(bundle: dict[str, dict[str, Any]]) -> tuple[str, str, str]:
    return (
        sha256(bundle["retained_failure_corpus"]),
        sha256(bundle["drift_report"]),
        sha256(bundle["replacement_governance"]),
    )


def semantic_artifacts_for(records: list[Any]) -> dict[str, dict[str, dict[str, Any]]]:
    return {record.refresh_id: artifact_bundle_for(record) for record in records}
