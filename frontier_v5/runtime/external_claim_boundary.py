#!/usr/bin/env python3
"""Claim boundary for MUSITU Axiom external-comparative evidence.

The structural comparative gate can establish that candidate and baseline
bundles are comparable in shape, case coverage and declared constraints. It
cannot authenticate the external origin of those bundles, prove that a strong
current system actually produced them, or independently validate the overall
evaluation.

This boundary deliberately prevents repository-local/self-attested data from
being promoted to Evidence Level 5, Level 6, or a leadership/superiority claim.
A later trusted external-verifier integration may emit a separately authenticated
verification record, but until that integration exists the outcome remains
blocked by construction.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
import hashlib
import json
import re

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class ExternalClaimBoundaryError(RuntimeError):
    """Raised when comparative/provenance evidence is malformed or contradictory."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ExternalClaimBoundaryError(f"{name} must be an object")
    return value


def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExternalClaimBoundaryError(f"{name} must be a non-empty string")
    return value.strip()


def _sha(value: Any, name: str) -> str:
    text = _string(value, name).lower()
    if not _HEX64.fullmatch(text):
        raise ExternalClaimBoundaryError(f"{name} must be a lowercase SHA-256 digest")
    return text


def _bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise ExternalClaimBoundaryError(f"{name} must be boolean")
    return value


class ExternalComparativeClaimBoundary:
    """Fail closed between structural comparison and evidence/claim promotion.

    The boundary is intentionally asymmetric:
      * structural comparison may be READY;
      * repository-local provenance may be well-formed;
      * Evidence Level 5 is still NOT VERIFIED until a trusted external
        verifier integration authenticates origin and execution;
      * Evidence Level 6 and leadership claims remain blocked separately.

    This prevents a self-authored ``externally_attested=true`` flag, hash, URL,
    provider/product label, or repository artifact from becoming evidence merely
    because its schema is valid.
    """

    TRUSTED_EXTERNAL_ROOT_TYPES = frozenset({
        "provider-signed-export",
        "connected-provider-readback",
        "independent-evaluator-signed",
    })

    @staticmethod
    def hash_object(value: Any) -> str:
        return _hash(value)

    @classmethod
    def assess(
        cls,
        comparison: Mapping[str, Any],
        provenance: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        comparison = _mapping(comparison, "comparison")
        comparison_sha256 = _sha(comparison.get("comparison_sha256"), "comparison.comparison_sha256")
        case_set_sha256 = _sha(comparison.get("case_set_sha256"), "comparison.case_set_sha256")
        constraints_sha256 = _sha(comparison.get("constraints_sha256"), "comparison.constraints_sha256")
        status = _string(comparison.get("status"), "comparison.status")

        if status not in {"SELF_TEST_ONLY", "EXTERNAL_COMPARISON_READY"}:
            raise ExternalClaimBoundaryError("comparison.status is not recognized")
        if comparison.get("leader_claim_allowed") is not False:
            raise ExternalClaimBoundaryError("structural comparison must never authorize a leader claim")
        if comparison.get("independent_validation_complete") is not False:
            raise ExternalClaimBoundaryError("structural comparison must never certify independent validation")

        structural_candidate = bool(comparison.get("evidence_level_5_eligible")) and status == "EXTERNAL_COMPARISON_READY"

        result: dict[str, Any] = {
            "schema": "musitu.axiom.frontier.external-claim-boundary.v1",
            "comparison_sha256": comparison_sha256,
            "case_set_sha256": case_set_sha256,
            "constraints_sha256": constraints_sha256,
            "structural_level_5_candidate": structural_candidate,
            "external_origin_authenticated": False,
            "evidence_level_5_verified": False,
            "independent_validation_complete": False,
            "evidence_level_6_verified": False,
            "leader_claim_allowed": False,
            "promotion_status": "BLOCKED_EXTERNAL_PROVENANCE_REQUIRED",
            "claim_policy": "NO_SELF_ATTESTED_LEVEL5_OR_SUPERIORITY",
        }

        if provenance is None:
            result["provenance_status"] = "MISSING"
            result["boundary_sha256"] = _hash(result)
            return result

        provenance = _mapping(provenance, "provenance")
        if _sha(provenance.get("comparison_sha256"), "provenance.comparison_sha256") != comparison_sha256:
            raise ExternalClaimBoundaryError("provenance comparison hash mismatch")
        if _sha(provenance.get("case_set_sha256"), "provenance.case_set_sha256") != case_set_sha256:
            raise ExternalClaimBoundaryError("provenance case-set hash mismatch")
        if _sha(provenance.get("constraints_sha256"), "provenance.constraints_sha256") != constraints_sha256:
            raise ExternalClaimBoundaryError("provenance constraints hash mismatch")

        root_type = _string(provenance.get("verification_root_type"), "provenance.verification_root_type")
        root_verified = _bool(provenance.get("verification_root_authenticated"), "provenance.verification_root_authenticated")
        source = _string(provenance.get("verification_source"), "provenance.verification_source")
        artifact_sha = _sha(provenance.get("verification_artifact_sha256"), "provenance.verification_artifact_sha256")

        records = provenance.get("records")
        if isinstance(records, (str, bytes, bytearray)) or not isinstance(records, Sequence) or not records:
            raise ExternalClaimBoundaryError("provenance.records must be a non-empty sequence")
        normalized_records: list[dict[str, Any]] = []
        for index, raw in enumerate(records):
            record = _mapping(raw, f"provenance.records[{index}]")
            normalized_records.append({
                "system_id": _string(record.get("system_id"), f"provenance.records[{index}].system_id"),
                "provider": _string(record.get("provider"), f"provenance.records[{index}].provider"),
                "product": _string(record.get("product"), f"provenance.records[{index}].product"),
                "version": _string(record.get("version"), f"provenance.records[{index}].version"),
                "result_bundle_sha256": _sha(
                    record.get("result_bundle_sha256"),
                    f"provenance.records[{index}].result_bundle_sha256",
                ),
            })

        # A repository-local/self-declared record can be audited for shape, but
        # it must never become Level 5. Even a known root type is insufficient
        # unless an external verifier integration has authenticated it outside
        # this candidate-under-test. That integration is intentionally absent
        # from this module and therefore the current verified result remains
        # false by construction.
        looks_external = root_type in cls.TRUSTED_EXTERNAL_ROOT_TYPES and root_verified
        result.update({
            "provenance_status": "STRUCTURALLY_VALID_UNAUTHENTICATED",
            "declared_external_root_type": root_type,
            "declared_root_authenticated": root_verified,
            "declared_verification_source": source,
            "verification_artifact_sha256": artifact_sha,
            "verification_records_sha256": _hash(normalized_records),
            "declared_external_shape": looks_external,
        })
        result["boundary_sha256"] = _hash(result)
        return result


__all__ = ["ExternalClaimBoundaryError", "ExternalComparativeClaimBoundary"]
