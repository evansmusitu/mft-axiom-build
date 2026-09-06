#!/usr/bin/env python3
"""Fail-closed sealed external-comparative evidence gate for MUSITU Axiom v5.

This module validates the *shape, comparability, completeness, and declared
attestation state* of comparative evidence.  It does not execute third-party
systems, independently authenticate an attestation, certify independent
validation, or authorize a leadership/superiority claim.

Synthetic fixtures are useful for testing this gate, but they are never
eligible for Level-5 evidence.  Real external baseline evidence must be
produced outside the candidate-under-test, use the same sealed case set and
constraints, and be separately provenance-verified before any comparative
claim is promoted.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
import hashlib
import json
import math
import re


_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class ComparativeGateError(RuntimeError):
    """Raised when comparative evidence is incomplete, incomparable, or unsafe."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _require_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ComparativeGateError(f"{name} must be an object")
    return value


def _require_nonempty_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ComparativeGateError(f"{name} must be a non-empty string")
    return value.strip()


def _require_sha256(value: Any, name: str) -> str:
    text = _require_nonempty_string(value, name).lower()
    if not _HEX64.fullmatch(text):
        raise ComparativeGateError(f"{name} must be a lowercase SHA-256 hex digest")
    return text


def _require_bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise ComparativeGateError(f"{name} must be boolean")
    return value


def _metric_value(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ComparativeGateError(f"{name} must be numeric")
    score = float(value)
    if not math.isfinite(score) or score < 0.0 or score > 1.0:
        raise ComparativeGateError(f"{name} must be finite and within [0,1]")
    return score


class ExternalComparativeGate:
    """Validate evidence before it can be considered Level-5 *eligible*.

    Eligibility is intentionally narrower than a claim.  This gate never sets
    ``independent_validation_complete`` or ``leader_claim_allowed`` to true.
    Level 6 requires an independently reproduced/reviewed evaluation, and a
    leadership claim requires an additional governed decision using current,
    sufficiently broad external evidence.
    """

    @staticmethod
    def hash_object(value: Any) -> str:
        return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()

    @classmethod
    def hash_cases(cls, cases: Sequence[Mapping[str, Any]]) -> str:
        return cls.hash_object(list(cases))

    @classmethod
    def hash_results(cls, results: Sequence[Mapping[str, Any]]) -> str:
        return cls.hash_object(list(results))

    @staticmethod
    def _validate_cases(cases: Any) -> list[Mapping[str, Any]]:
        if isinstance(cases, (str, bytes, bytearray)) or not isinstance(cases, Sequence) or not cases:
            raise ComparativeGateError("cases must be a non-empty sequence")
        out: list[Mapping[str, Any]] = []
        seen: set[str] = set()
        for idx, raw in enumerate(cases):
            case = _require_mapping(raw, f"cases[{idx}]")
            case_id = _require_nonempty_string(case.get("case_id"), f"cases[{idx}].case_id")
            if case_id in seen:
                raise ComparativeGateError(f"duplicate case_id: {case_id}")
            seen.add(case_id)
            _require_nonempty_string(case.get("domain"), f"cases[{idx}].domain")
            _require_sha256(case.get("prompt_sha256"), f"cases[{idx}].prompt_sha256")
            out.append(case)
        return out

    @staticmethod
    def _validate_metrics(value: Any) -> tuple[str, ...]:
        if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence) or not value:
            raise ComparativeGateError("metrics must be a non-empty sequence")
        metrics = tuple(_require_nonempty_string(x, "metric") for x in value)
        if len(set(metrics)) != len(metrics):
            raise ComparativeGateError("metrics must be unique")
        return metrics

    @classmethod
    def _validate_system(
        cls,
        raw: Any,
        *,
        label: str,
        expected_case_ids: set[str],
        metrics: tuple[str, ...],
        case_set_sha256: str,
        constraints_sha256: str,
    ) -> tuple[Mapping[str, Any], dict[str, float]]:
        system = _require_mapping(raw, label)
        for key in ("system_id", "provider", "product", "version"):
            _require_nonempty_string(system.get(key), f"{label}.{key}")

        if _require_sha256(system.get("case_set_sha256"), f"{label}.case_set_sha256") != case_set_sha256:
            raise ComparativeGateError(f"{label} case set does not match sealed case set")
        if _require_sha256(system.get("constraints_sha256"), f"{label}.constraints_sha256") != constraints_sha256:
            raise ComparativeGateError(f"{label} constraints do not match sealed constraints")

        results = system.get("results")
        if isinstance(results, (str, bytes, bytearray)) or not isinstance(results, Sequence) or not results:
            raise ComparativeGateError(f"{label}.results must be a non-empty sequence")
        result_list = list(results)
        declared_results_hash = _require_sha256(system.get("results_sha256"), f"{label}.results_sha256")
        if cls.hash_results(result_list) != declared_results_hash:
            raise ComparativeGateError(f"{label} results hash mismatch")

        seen: set[str] = set()
        sums = {metric: 0.0 for metric in metrics}
        for idx, raw_result in enumerate(result_list):
            result = _require_mapping(raw_result, f"{label}.results[{idx}]")
            case_id = _require_nonempty_string(result.get("case_id"), f"{label}.results[{idx}].case_id")
            if case_id in seen:
                raise ComparativeGateError(f"{label} duplicate result case_id: {case_id}")
            seen.add(case_id)
            for metric in metrics:
                sums[metric] += _metric_value(result.get(metric), f"{label}.{case_id}.{metric}")

        if seen != expected_case_ids:
            missing = sorted(expected_case_ids - seen)
            extra = sorted(seen - expected_case_ids)
            raise ComparativeGateError(f"{label} case coverage mismatch: missing={missing} extra={extra}")

        count = len(expected_case_ids)
        scores = {metric: sums[metric] / count for metric in metrics}
        scores["overall"] = sum(scores[m] for m in metrics) / len(metrics)
        return system, scores

    def evaluate(
        self,
        manifest: Mapping[str, Any],
        cases: Sequence[Mapping[str, Any]],
        constraints: Mapping[str, Any],
        musitu: Mapping[str, Any],
        baselines: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        manifest = _require_mapping(manifest, "manifest")
        case_list = self._validate_cases(cases)
        constraints = _require_mapping(constraints, "constraints")
        suite_id = _require_nonempty_string(manifest.get("suite_id"), "manifest.suite_id")

        if _require_bool(manifest.get("sealed"), "manifest.sealed") is not True:
            raise ComparativeGateError("comparative suite must be sealed")
        if _require_bool(manifest.get("unseen"), "manifest.unseen") is not True:
            raise ComparativeGateError("comparative suite must be unseen")
        contamination = _require_nonempty_string(
            manifest.get("contamination_status"), "manifest.contamination_status"
        )
        if contamination != "clean":
            raise ComparativeGateError("comparative suite contamination status must be clean")

        metrics = self._validate_metrics(manifest.get("metrics"))
        minimum = manifest.get("minimum_external_baselines")
        if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 1:
            raise ComparativeGateError("minimum external baseline count must be an integer >= 1")

        actual_case_hash = self.hash_cases(case_list)
        declared_case_hash = _require_sha256(manifest.get("case_set_sha256"), "manifest.case_set_sha256")
        if actual_case_hash != declared_case_hash:
            raise ComparativeGateError("sealed case set hash mismatch")
        actual_constraints_hash = self.hash_object(constraints)
        declared_constraints_hash = _require_sha256(
            manifest.get("constraints_sha256"), "manifest.constraints_sha256"
        )
        if actual_constraints_hash != declared_constraints_hash:
            raise ComparativeGateError("sealed constraints hash mismatch")

        if isinstance(baselines, (str, bytes, bytearray)) or not isinstance(baselines, Sequence):
            raise ComparativeGateError("baselines must be a sequence")
        baseline_list = list(baselines)
        if len(baseline_list) < minimum:
            raise ComparativeGateError(
                f"external baseline count {len(baseline_list)} is below required baseline count {minimum}"
            )

        expected_case_ids = {str(c["case_id"]) for c in case_list}
        musitu_bundle, musitu_scores = self._validate_system(
            musitu,
            label="musitu",
            expected_case_ids=expected_case_ids,
            metrics=metrics,
            case_set_sha256=actual_case_hash,
            constraints_sha256=actual_constraints_hash,
        )
        musitu_id = str(musitu_bundle["system_id"])

        system_scores: dict[str, dict[str, float]] = {musitu_id: musitu_scores}
        baseline_ids: set[str] = set()
        externally_eligible = True
        for idx, raw_baseline in enumerate(baseline_list):
            baseline, scores = self._validate_system(
                raw_baseline,
                label=f"baseline[{idx}]",
                expected_case_ids=expected_case_ids,
                metrics=metrics,
                case_set_sha256=actual_case_hash,
                constraints_sha256=actual_constraints_hash,
            )
            baseline_id = str(baseline["system_id"])
            if baseline_id == musitu_id or baseline_id in baseline_ids:
                raise ComparativeGateError("baseline system_id must be unique and distinct from MUSITU")
            baseline_ids.add(baseline_id)
            synthetic = _require_bool(baseline.get("synthetic"), f"baseline[{idx}].synthetic")
            attested = _require_bool(
                baseline.get("externally_attested"), f"baseline[{idx}].externally_attested"
            )
            if synthetic or not attested:
                externally_eligible = False
            system_scores[baseline_id] = scores

        status = "EXTERNAL_COMPARISON_READY" if externally_eligible else "SELF_TEST_ONLY"
        comparison_basis = {
            "suite_id": suite_id,
            "status": status,
            "case_set_sha256": actual_case_hash,
            "constraints_sha256": actual_constraints_hash,
            "metrics": list(metrics),
            "systems": sorted(system_scores),
            "system_scores": system_scores,
        }
        return {
            **comparison_basis,
            "comparison_sha256": self.hash_object(comparison_basis),
            "case_count": len(case_list),
            "baseline_count": len(baseline_list),
            "evidence_level_5_eligible": externally_eligible,
            "independent_validation_complete": False,
            "leader_claim_allowed": False,
            "claim_policy": "COMPARISON_ONLY_NO_LEADERSHIP_CERTIFICATION",
        }


__all__ = ["ComparativeGateError", "ExternalComparativeGate"]
