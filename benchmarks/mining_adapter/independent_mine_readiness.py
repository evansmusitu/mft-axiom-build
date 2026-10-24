"""Fail-closed independent methane-data suitability and evidence-procurement audit.

This evaluates *metadata and claimed evidence*, never authenticates site,
licensing, event labels or signatures; never modifies the existing four-fold
methane gate; never executes inference or promotes a model. Its output is an
auditable list of evidence requirements, not a release authorization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS
from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec

SCHEMA = "musitu.axiom.independent_mine_candidate.v1"
REPORT_SCHEMA = "musitu.axiom.independent_mine_readiness.v1"
SOURCE_HASH = "28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc"
FROZEN_MANIFEST_HASH = "f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf"
REJECTED_SOURCE_MARKERS = (
    "yd7vw4c5mk", "10.17632/yd7vw4c5mk", "openml:42701",
    "openml.org/d/42701", "openml.org/search?type=data&id=42701",
)
REQUIRED_EXTERNAL_REVIEWS = (
    "source_owner_data_use_authorization",
    "independent_site_chain_of_custody",
    "measurement_units_and_calibration",
    "sensor_positions_and_operating_context",
    "physically_observed_methane_event_annotations",
    "locked_holdout_protocol_before_test_access",
    "independent_reviewer_identity_and_approval",
)
HEX = set("0123456789abcdef")


def _is_sha256(v: Any) -> bool:
    return isinstance(v, str) and len(v) == 64 and all(ch in HEX for ch in v)


def _uniq(values: Any) -> bool:
    return isinstance(values, list) and all(
        isinstance(x, str) and bool(x.strip()) for x in values
    ) and len(values) == len(set(values))


def _external_reference(value: Any) -> bool:
    # Nonempty private reference is a declaration, not authenticating evidence.
    return isinstance(value, str) and 4 <= len(value.strip()) <= 512


def screen_independent_mine_candidate(candidate: Mapping[str, Any]) -> dict[str, Any]:
    """Reject known source reuse and unsupported schemas; never grant admission.

    The input is a non-sensitive metadata descriptor; do not pass credentials,
    mine addresses, original telemetry or unredacted contracts.
    """
    if not isinstance(candidate, dict) or candidate.get("schema") != SCHEMA:
        raise ValueError("independent_mine_candidate_schema_invalid")
    source_id = candidate.get("candidate_id")
    if not isinstance(source_id, str) or not source_id or len(source_id) > 128:
        raise ValueError("independent_mine_candidate_id_invalid")
    lineage = candidate.get("source_lineage_identifiers")
    if not _uniq(lineage):
        raise ValueError("independent_mine_lineage_invalid")
    if len(lineage) < 1:
        raise ValueError("independent_mine_lineage_required")
    canonical = candidate.get("canonical_source_sha256")
    original = candidate.get("original_source_sha256")
    if canonical is not None and not _is_sha256(canonical):
        raise ValueError("independent_mine_source_sha256_invalid")
    if original is not None and not _is_sha256(original):
        raise ValueError("independent_mine_original_sha256_invalid")
    source_aliases = " ".join(lineage).casefold()
    known_development_source = (
        canonical == SOURCE_HASH or original == SOURCE_HASH or
        any(s in source_aliases for s in REJECTED_SOURCE_MARKERS)
    )
    model_sha = candidate.get("frozen_model_manifest_sha256")
    if model_sha is not None and not _is_sha256(model_sha):
        raise ValueError("independent_mine_model_pin_invalid")

    reasons: list[str] = []
    if known_development_source:
        reasons.append("REUSED_OR_ALIASED_DEVELOPMENT_SOURCE")
    if candidate.get("data_kind") != "underground_operational_sensor_stream":
        reasons.append("NO_ELIGIBLE_UNDERGROUND_SENSOR_STREAM")
    if type(candidate.get("sampling_seconds")) is not int or candidate.get("sampling_seconds") != 1:
        reasons.append("ONE_SECOND_SOURCE_CADENCE_NOT_VERIFIED")
    names = candidate.get("independently_measured_canonical_sensors")
    if (not _uniq(names) or set(names) != set(MINING_TELEMETRY_SENSORS)):
        reasons.append("FULL_28_MEASURED_SENSOR_CHANNELS_NOT_VERIFIED")
    if candidate.get("identity_mapping_only") is not True:
        reasons.append("NO_LOSSLESS_IDENTITY_MAPPING_PROOF")
    if candidate.get("raw_sensor_readings_unmodified") is not True:
        reasons.append("NO_UNMODIFIED_SENSOR_READINGS_PROOF")
    if not _is_sha256(original) or not _is_sha256(canonical):
        reasons.append("SOURCE_BYTE_PROVENANCE_NOT_AVAILABLE")
    if model_sha != FROZEN_MANIFEST_HASH:
        reasons.append("FROZEN_MODEL_PIN_NOT_VERIFIED")

    reviews = candidate.get("external_review_references")
    if not isinstance(reviews, dict):
        reviews = {}
    missing_review = [key for key in REQUIRED_EXTERNAL_REVIEWS if not _external_reference(reviews.get(key))]
    if missing_review:
        reasons.append("THIRD_PARTY_INDEPENDENCE_AND_SAFETY_REVIEW_INCOMPLETE")
    # References supplied inside a JSON file are *not* independently verified.
    # No mere 'approved=true' input is allowed to satisfy this requirement.
    reasons.append("OUT_OF_BAND_REVIEW_AUTHENTICITY_NOT_ESTABLISHED")

    spec = MethaneBacktestSpec()
    counts = candidate.get("prospective_fold_positive_label_windows")
    eligible_counts = (
        isinstance(counts, list) and len(counts) == spec.fold_count and
        all(type(x) is int and x >= 0 for x in counts)
    )
    sufficiently_supported = bool(
        eligible_counts and sum(x >= spec.minimum_fold_test_positives for x in counts)
        >= spec.required_passing_folds
    )
    if not sufficiently_supported:
        reasons.append("INDEPENDENT_HOLDOUT_POSITIVE_SUPPORT_NOT_PROVEN")
    if candidate.get("independent_physical_events_reviewed") is not True:
        reasons.append("DISTINCT_PHYSICAL_METHANE_EVENTS_UNVERIFIED")
    if candidate.get("prospective_holdout_sealed_before_test_access") is not True:
        reasons.append("PROSPECTIVE_HOLDOUT_SEPARATION_NOT_PROVEN")
    if candidate.get("external_model_evaluation_artifact_verified") is not True:
        reasons.append("EXTERNAL_FROZEN_MODEL_PERFORMANCE_NOT_PROVEN")
    if candidate.get("mining_operational_alarms_and_response_verified") is not True:
        reasons.append("OPERATIONAL_ALERT_RESPONSE_NOT_VERIFIED")

    unique_reasons = list(dict.fromkeys(reasons))
    result = {
        "schema": REPORT_SCHEMA,
        "candidate_id": source_id,  # the caller must use a nonidentifying alias
        "candidate_metadata_sha256": hashlib.sha256(
            (json.dumps(candidate, sort_keys=True, separators=(",", ":"), allow_nan=False)).encode()
        ).hexdigest(),
        "status": "INDEPENDENT_MINE_QUALIFICATION_BLOCKED",
        "known_development_source": known_development_source,
        "declared_full_canonical_sensor_coverage": (
            _uniq(names) and set(names) == set(MINING_TELEMETRY_SENSORS)
        ),
        "claimed_positive_support_folds": sum(
            x >= spec.minimum_fold_test_positives for x in counts
        ) if eligible_counts else None,
        "minimum_positive_label_windows_per_supported_fold": spec.minimum_fold_test_positives,
        "required_supported_folds": spec.required_passing_folds,
        "outstanding_requirements": unique_reasons,
        "outstanding_external_review_categories": missing_review,
        "self_asserted_reviews_are_not_verified_evidence": True,
        "label_window_groups_are_not_distinct_physical_events": True,
        "compatible_with_frozen_model_proven": False,
        "independent_validation": False,
        "production_methane_prediction_qualification": False,
        "production_admission": False,
        "existing_production_axiom_compute_must_remain_unchanged": True,
        "pr_9_merge_authorized": False,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Research-only independent mine candidate evidence gap auditor")
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve() == args.candidate.resolve():
        raise FileExistsError("independent_mine_report_must_be_new")
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    result = screen_independent_mine_candidate(candidate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "outstanding_requirements": len(result["outstanding_requirements"]),
        "production_admission": False
    }, sort_keys=True))


if __name__ == "__main__":
    main()
