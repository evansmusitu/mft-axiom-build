#!/usr/bin/env python3
"""Behavioral contract for DEF-015 benchmark/external-baseline governance.

The synthetic positive fixture proves that the validator is capable of
recognizing complete promotion evidence.  It is not persisted evidence and can
never certify MUSITU.  The checked-in live registry must remain blocked until
real authenticated external runs populate the required evidence fields.
"""
from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

try:
    from frontier_v5.runtime.benchmark_registry import (
        BenchmarkRegistryError,
        BenchmarkRegistryGate,
    )
except ModuleNotFoundError as exc:
    raise AssertionError("benchmark-registry runtime is missing") from exc

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "frontier_v5/evals/EXTERNAL_BASELINE_REGISTRY.json"
NOW = datetime(2026, 9, 7, 4, 0, 0, tzinfo=timezone.utc)
CASE_HASH = "a" * 64
CONSTRAINTS_HASH = "b" * 64
RESULT_HASHES = ("c" * 64, "d" * 64, "e" * 64)
PROVENANCE_HASHES = ("1" * 64, "2" * 64, "3" * 64)
DOMAINS = [
    "quantitative_reasoning",
    "multi_source_research",
    "artifact_work",
    "browser_computer_use",
    "multimodal_reasoning",
    "long_horizon_agent_execution",
]


def expect_block(fn, contains: str) -> None:
    try:
        fn()
    except BenchmarkRegistryError as exc:
        if contains not in str(exc):
            raise AssertionError(f"expected {contains!r} in {str(exc)!r}") from exc
    else:
        raise AssertionError(f"expected BenchmarkRegistryError containing {contains!r}")


def reference(index: int, provider: str, domains: list[str]) -> dict[str, object]:
    slug = provider.lower().replace(" ", "-")
    return {
        "registry_id": f"fixture-{slug}",
        "provider": provider,
        "system_class": "fixture_current_strong_system",
        "system_version": f"fixture-v{index + 1}",
        "license_status": "AUTHORIZED_FOR_EVALUATION",
        "access_status": "AUTHORIZED_CURRENT_ACCESS",
        "evidence_status": "AUTHENTICATED_EXTERNAL_RUN",
        "contamination_status": "CLEAN",
        "reviewed_at": "2026-09-07T00:00:00Z",
        "expires_at": "2026-09-30T00:00:00Z",
        "comparison_domains": domains,
        "sealed_case_set_sha256": CASE_HASH,
        "constraints_sha256": CONSTRAINTS_HASH,
        "results_sha256": RESULT_HASHES[index],
        "external_provenance_sha256": PROVENANCE_HASHES[index],
        "failures_retained": True,
        "external_origin_authenticated": True,
    }


def complete_fixture() -> dict[str, object]:
    return {
        "schema": "musitu.axiom.frontier.external-baseline-registry.v2",
        "purpose": "Synthetic contract fixture only.",
        "evidence_rule": "Authenticated external execution required.",
        "registry_reviewed_at": "2026-09-07T00:00:00Z",
        "registry_expires_at": "2026-09-30T00:00:00Z",
        "minimum_distinct_external_providers_for_broad_claim": 3,
        "required_comparison_domains": DOMAINS,
        "references": [
            reference(0, "Fixture Provider A", DOMAINS[:2]),
            reference(1, "Fixture Provider B", DOMAINS[2:4]),
            reference(2, "Fixture Provider C", DOMAINS[4:]),
        ],
        "current_level5_status": "NOT_VERIFIED",
        "current_level6_status": "NOT_VERIFIED",
        "current_global_superiority_status": "NOT_CERTIFIED",
    }


def main() -> None:
    gate = BenchmarkRegistryGate()

    # The checked-in registry must be structurally governed but cannot certify
    # a comparison while every external reference remains unexecuted.
    live = json.loads(REGISTRY.read_text(encoding="utf-8"))
    live_structure = gate.validate_registry(live, now=NOW)
    assert live_structure["gate"] == "PASS"
    assert live_structure["reference_count"] >= 3
    live_result = gate.evaluate_promotion(
        live,
        now=NOW,
        expected_case_set_sha256=None,
        expected_constraints_sha256=None,
    )
    assert live_result["status"] == "BLOCKED"
    assert live_result["eligible_reference_count"] == 0
    assert live_result["level5_eligible"] is False
    expect_block(
        lambda: gate.require_promotion(
            live,
            now=NOW,
            expected_case_set_sha256=None,
            expected_constraints_sha256=None,
        ),
        "promotion blocked",
    )

    # A complete fixture proves the policy can recognize a fully governed set.
    good = complete_fixture()
    ready = gate.evaluate_promotion(
        good,
        now=NOW,
        expected_case_set_sha256=CASE_HASH,
        expected_constraints_sha256=CONSTRAINTS_HASH,
    )
    assert ready["status"] == "PROMOTION_READY"
    assert ready["level5_eligible"] is True
    assert ready["distinct_provider_count"] == 3
    assert set(ready["covered_domains"]) == set(DOMAINS)
    required = gate.require_promotion(
        good,
        now=NOW,
        expected_case_set_sha256=CASE_HASH,
        expected_constraints_sha256=CONSTRAINTS_HASH,
    )
    assert required["gate"] == "PASS"

    # Missing evidence cannot be promoted.
    bad = deepcopy(good)
    bad["references"] = bad["references"][:2]
    expect_block(
        lambda: gate.require_promotion(
            bad,
            now=NOW,
            expected_case_set_sha256=CASE_HASH,
            expected_constraints_sha256=CONSTRAINTS_HASH,
        ),
        "distinct external provider",
    )

    bad = deepcopy(good)
    bad["references"][0]["sealed_case_set_sha256"] = None
    expect_block(
        lambda: gate.require_promotion(
            bad,
            now=NOW,
            expected_case_set_sha256=CASE_HASH,
            expected_constraints_sha256=CONSTRAINTS_HASH,
        ),
        "sealed case hash",
    )

    # Expired evidence and an expired registry fail closed.
    bad = deepcopy(good)
    bad["references"][0]["expires_at"] = "2026-09-06T23:59:59Z"
    expect_block(
        lambda: gate.require_promotion(
            bad,
            now=NOW,
            expected_case_set_sha256=CASE_HASH,
            expected_constraints_sha256=CONSTRAINTS_HASH,
        ),
        "expired",
    )
    bad = deepcopy(good)
    bad["registry_expires_at"] = "2026-09-06T23:59:59Z"
    expect_block(lambda: gate.validate_registry(bad, now=NOW), "registry expired")

    # Contamination, mismatched constraints, unlicensed access, dropped failures,
    # unauthenticated origin, or duplicate providers must all fail promotion.
    mutations = [
        ("contamination_status", "CONTAMINATED", "contamination"),
        ("constraints_sha256", "f" * 64, "constraints hash"),
        ("license_status", "LICENSE_NOT_AUTHORIZED", "license"),
        ("failures_retained", False, "failures retained"),
        ("external_origin_authenticated", False, "external origin"),
    ]
    for key, value, message in mutations:
        bad = deepcopy(good)
        bad["references"][0][key] = value
        expect_block(
            lambda bad=bad: gate.require_promotion(
                bad,
                now=NOW,
                expected_case_set_sha256=CASE_HASH,
                expected_constraints_sha256=CONSTRAINTS_HASH,
            ),
            message,
        )

    bad = deepcopy(good)
    bad["references"][1]["provider"] = bad["references"][0]["provider"]
    expect_block(
        lambda: gate.require_promotion(
            bad,
            now=NOW,
            expected_case_set_sha256=CASE_HASH,
            expected_constraints_sha256=CONSTRAINTS_HASH,
        ),
        "distinct external provider",
    )

    # Domain coverage is part of the promotion contract, not documentation.
    bad = deepcopy(good)
    bad["references"][2]["comparison_domains"] = ["multimodal_reasoning"]
    expect_block(
        lambda: gate.require_promotion(
            bad,
            now=NOW,
            expected_case_set_sha256=CASE_HASH,
            expected_constraints_sha256=CONSTRAINTS_HASH,
        ),
        "comparison domain",
    )

    print("MUSITU_AXIOM_FRONTIER_BENCHMARK_REGISTRY_PASS")


if __name__ == "__main__":
    main()
