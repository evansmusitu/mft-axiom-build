from __future__ import annotations

import json

from frontier_review_safe.longitudinal_binding import LongitudinalArtifactBundle, artifact_sha256


def _json_text(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def level7_artifact_fields(
    *,
    candidate_sha: str,
    case_set_hash: str,
    baseline_registry_hash: str,
    generated_at: str,
) -> dict[str, object]:
    retained_failure_corpus = {
        "schema": "musitu.axiom.retained-failure-corpus.v1",
        "candidate_sha": candidate_sha,
        "case_set_hash": case_set_hash,
        "generated_at": generated_at,
        "failures": [],
    }
    drift_report = {
        "schema": "musitu.axiom.drift-report.v1",
        "candidate_sha": candidate_sha,
        "case_set_hash": case_set_hash,
        "baseline_registry_hash": baseline_registry_hash,
        "generated_at": generated_at,
        "observations": [],
        "overall_status": "indeterminate",
    }
    replacement_governance = {
        "schema": "musitu.axiom.replacement-governance.v1",
        "candidate_sha": candidate_sha,
        "case_set_hash": case_set_hash,
        "generated_at": generated_at,
        "decision_id": f"retain:{baseline_registry_hash[:16]}:{generated_at}",
        "decision": "retain",
        "baseline_registry_hash_before": baseline_registry_hash,
        "baseline_registry_hash_after": baseline_registry_hash,
        "rationale": "Retain the observed baseline registry for this longitudinal refresh.",
        "evidence_hash": "e" * 64,
    }
    corpus_json = _json_text(retained_failure_corpus)
    drift_json = _json_text(drift_report)
    governance_json = _json_text(replacement_governance)
    return {
        "retained_failure_corpus_hash": artifact_sha256(corpus_json),
        "drift_report_hash": artifact_sha256(drift_json),
        "replacement_governance_hash": artifact_sha256(governance_json),
        "artifact_bundle": LongitudinalArtifactBundle(
            retained_failure_corpus_json=corpus_json,
            drift_report_json=drift_json,
            replacement_governance_json=governance_json,
        ),
    }
