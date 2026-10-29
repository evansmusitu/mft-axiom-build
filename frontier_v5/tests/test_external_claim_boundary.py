#!/usr/bin/env python3
"""Regression tests that prevent self-attested Level-5 claim promotion."""
from __future__ import annotations

from copy import deepcopy

from frontier_v5.runtime.external_claim_boundary import (
    ExternalClaimBoundaryError,
    ExternalComparativeClaimBoundary,
)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except ExternalClaimBoundaryError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected ExternalClaimBoundaryError")


def comparison(status="EXTERNAL_COMPARISON_READY", eligible=True):
    return {
        "status": status,
        "comparison_sha256": "a" * 64,
        "case_set_sha256": "b" * 64,
        "constraints_sha256": "c" * 64,
        "evidence_level_5_eligible": eligible,
        "independent_validation_complete": False,
        "leader_claim_allowed": False,
    }


def provenance():
    return {
        "comparison_sha256": "a" * 64,
        "case_set_sha256": "b" * 64,
        "constraints_sha256": "c" * 64,
        "verification_root_type": "provider-signed-export",
        "verification_root_authenticated": True,
        "verification_source": "fixture://self-declared-provider-export",
        "verification_artifact_sha256": "d" * 64,
        "records": [
            {
                "system_id": "strong-baseline-a",
                "provider": "FixtureVendorA",
                "product": "fixture-product",
                "version": "fixture-version",
                "result_bundle_sha256": "e" * 64,
            }
        ],
    }


def main() -> None:
    # A structurally ready comparison without external provenance is blocked.
    out = ExternalComparativeClaimBoundary.assess(comparison())
    assert out["structural_level_5_candidate"] is True
    assert out["external_origin_authenticated"] is False
    assert out["evidence_level_5_verified"] is False
    assert out["evidence_level_6_verified"] is False
    assert out["leader_claim_allowed"] is False
    assert out["promotion_status"] == "BLOCKED_EXTERNAL_PROVENANCE_REQUIRED"

    # Critically, self-declared provider-signed/externally-authenticated fields
    # still cannot promote Level 5. Schema-valid data is not external truth.
    out = ExternalComparativeClaimBoundary.assess(comparison(), provenance())
    assert out["provenance_status"] == "STRUCTURALLY_VALID_UNAUTHENTICATED"
    assert out["declared_external_shape"] is True
    assert out["external_origin_authenticated"] is False
    assert out["evidence_level_5_verified"] is False
    assert out["independent_validation_complete"] is False
    assert out["leader_claim_allowed"] is False

    # Synthetic/self-test structural comparisons also remain blocked.
    out = ExternalComparativeClaimBoundary.assess(comparison("SELF_TEST_ONLY", False), provenance())
    assert out["structural_level_5_candidate"] is False
    assert out["evidence_level_5_verified"] is False

    # Any attempt to smuggle a leadership or independent-validation claim out
    # of the structural gate is rejected rather than normalized.
    bad = comparison()
    bad["leader_claim_allowed"] = True
    expect_error(lambda: ExternalComparativeClaimBoundary.assess(bad), "leader")

    bad = comparison()
    bad["independent_validation_complete"] = True
    expect_error(lambda: ExternalComparativeClaimBoundary.assess(bad), "independent")

    # Provenance must be cryptographically bound to the same comparison inputs.
    badp = deepcopy(provenance())
    badp["case_set_sha256"] = "f" * 64
    expect_error(lambda: ExternalComparativeClaimBoundary.assess(comparison(), badp), "case-set")

    print("MUSITU_AXIOM_FRONTIER_EXTERNAL_CLAIM_BOUNDARY_PASS")


if __name__ == "__main__":
    main()
