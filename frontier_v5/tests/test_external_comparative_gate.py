#!/usr/bin/env python3
"""Red/green contract for externally comparable sealed evaluation evidence.

Synthetic fixtures are permitted only to verify the gate itself. They must
never be promoted to Level-5 evidence or a leadership/superiority claim.
"""
from __future__ import annotations

from copy import deepcopy

from frontier_v5.runtime.external_comparative import (
    ComparativeGateError,
    ExternalComparativeGate,
)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except ComparativeGateError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected error containing {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected ComparativeGateError")


def fixture():
    cases = [
        {"case_id": "quant-001", "domain": "quantitative_reasoning", "prompt_sha256": "1" * 64},
        {"case_id": "research-001", "domain": "research", "prompt_sha256": "2" * 64},
        {"case_id": "artifact-001", "domain": "artifact_work", "prompt_sha256": "3" * 64},
    ]
    constraints = {
        "tool_policy": "comparable",
        "data_cutoff": "2026-09-06",
        "time_budget_seconds": 900,
        "human_intervention": "none",
    }
    case_hash = ExternalComparativeGate.hash_cases(cases)
    constraints_hash = ExternalComparativeGate.hash_object(constraints)
    manifest = {
        "suite_id": "musitu-frontier-comparative-self-test-v1",
        "sealed": True,
        "unseen": True,
        "contamination_status": "clean",
        "case_set_sha256": case_hash,
        "constraints_sha256": constraints_hash,
        "metrics": ["quality", "grounding", "safety"],
        "minimum_external_baselines": 2,
    }
    def system(system_id: str, provider: str, *, synthetic: bool, externally_attested: bool, values=(0.6, 0.7, 0.8)):
        results = []
        for case, score in zip(cases, values):
            results.append({
                "case_id": case["case_id"],
                "quality": score,
                "grounding": score,
                "safety": 1.0,
            })
        bundle = {
            "system_id": system_id,
            "provider": provider,
            "product": "fixture-product",
            "version": "fixture-version",
            "synthetic": synthetic,
            "externally_attested": externally_attested,
            "case_set_sha256": case_hash,
            "constraints_sha256": constraints_hash,
            "results": results,
        }
        bundle["results_sha256"] = ExternalComparativeGate.hash_results(results)
        return bundle
    musitu = system("musitu-axiom", "MUSITU", synthetic=False, externally_attested=False, values=(0.8, 0.8, 0.9))
    synthetic = [
        system("strong-baseline-a", "FixtureVendorA", synthetic=True, externally_attested=False),
        system("strong-baseline-b", "FixtureVendorB", synthetic=True, externally_attested=False, values=(0.7, 0.65, 0.75)),
    ]
    attested = [
        system("strong-baseline-a", "FixtureVendorA", synthetic=False, externally_attested=True),
        system("strong-baseline-b", "FixtureVendorB", synthetic=False, externally_attested=True, values=(0.7, 0.65, 0.75)),
    ]
    return cases, constraints, manifest, musitu, synthetic, attested


def main() -> None:
    cases, constraints, manifest, musitu, synthetic, attested = fixture()
    gate = ExternalComparativeGate()

    # Self-test fixtures prove the gate, never Level-5 evidence.
    out = gate.evaluate(manifest, cases, constraints, musitu, synthetic)
    assert out["status"] == "SELF_TEST_ONLY"
    assert out["evidence_level_5_eligible"] is False
    assert out["independent_validation_complete"] is False
    assert out["leader_claim_allowed"] is False
    assert out["baseline_count"] == 2
    assert out["case_count"] == 3

    # A complete externally attested comparison may become Level-5 eligible,
    # but this gate alone must still not authorize a leadership claim because
    # Level 6 independent validation is a separate requirement.
    out = gate.evaluate(manifest, cases, constraints, musitu, attested)
    assert out["status"] == "EXTERNAL_COMPARISON_READY"
    assert out["evidence_level_5_eligible"] is True
    assert out["independent_validation_complete"] is False
    assert out["leader_claim_allowed"] is False
    assert set(out["system_scores"]) == {"musitu-axiom", "strong-baseline-a", "strong-baseline-b"}

    # Contaminated, unsealed, mismatched or incomplete evidence must fail closed.
    bad = deepcopy(manifest)
    bad["contamination_status"] = "known-contaminated"
    expect_error(lambda: gate.evaluate(bad, cases, constraints, musitu, attested), "contamination")

    bad = deepcopy(manifest)
    bad["sealed"] = False
    expect_error(lambda: gate.evaluate(bad, cases, constraints, musitu, attested), "sealed")

    bad_baselines = deepcopy(attested)
    bad_baselines[0]["results"] = bad_baselines[0]["results"][:-1]
    bad_baselines[0]["results_sha256"] = ExternalComparativeGate.hash_results(bad_baselines[0]["results"])
    expect_error(lambda: gate.evaluate(manifest, cases, constraints, musitu, bad_baselines), "case coverage")

    bad_baselines = deepcopy(attested)
    bad_baselines[0]["constraints_sha256"] = "f" * 64
    expect_error(lambda: gate.evaluate(manifest, cases, constraints, musitu, bad_baselines), "constraints")

    bad_baselines = deepcopy(attested)
    bad_baselines[0]["results_sha256"] = "0" * 64
    expect_error(lambda: gate.evaluate(manifest, cases, constraints, musitu, bad_baselines), "results hash")

    bad = deepcopy(manifest)
    bad["minimum_external_baselines"] = 3
    expect_error(lambda: gate.evaluate(bad, cases, constraints, musitu, attested), "baseline")

    print("MUSITU_AXIOM_FRONTIER_EXTERNAL_COMPARATIVE_GATE_PASS")


if __name__ == "__main__":
    main()
