from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping
import json
import math
import sys

from .core import sha256


BASELINE_CONTRACT: dict[str, Any] = {
    "schema": "musitu.axiom.review-safe-scale-baseline.v1",
    "scope": "internal GitHub-hosted Ubuntu 24.04 x86_64 CPython 3.12.14 regression envelope only",
    "baseline_candidate_sha": "ad2cb13b6612ad1035d7cda54ad0c3c56d0faeb0",
    "workflow_run_id": 34558594971,
    "workflow_run_attempts": 3,
    "workload_git_blob_sha": "8ec6e9238a8338b86d88a62a2fdc6cdd94714af5",
    "evidence_sha256": (
        "58531599162eeec4bf9423ac1522f20530001878f30750f3c9f3968349c1b714",
        "290f732e957b5a0a688fdac4c511a69b5d99245813f2097474566ffd5f5cc8ab",
        "45e32999d20c580fb06981dc31c99c83ecca204067c86e45ba3ef2dd7e7a98a6",
    ),
    "environment": {
        "python": "3.12.14",
        "implementation": "CPython",
        "machine": "x86_64",
        "runner": "ubuntu-24.04",
    },
    "policy": {
        "elapsed_multiplier": 2.5,
        "elapsed_fixed_margin_ms": 100.0,
        "memory_multiplier": 2.0,
        "memory_fixed_margin_bytes": 1048576,
        "minimum_throughput_fraction": 0.4,
    },
    "observed_worst": {
        "temporal_evidence_graph_10k": {
            "max_elapsed_ms": 4187.470,
            "max_peak_python_bytes": 12047511,
            "min_throughput_per_sec": 2388.077,
        },
        "correlated_scenario_grid_10k_rows": {
            "max_elapsed_ms": 1101.580,
            "max_peak_python_bytes": 8697216,
            "min_throughput_per_sec": 9077.868,
        },
        "decision_ledger_3k_events": {
            "max_elapsed_ms": 1309.520,
            "max_peak_python_bytes": 7729606,
            "min_throughput_per_sec": 2290.916,
        },
        "persistent_adaptation_100_releases": {
            "max_elapsed_ms": 582.103,
            "max_peak_python_bytes": 743457,
            "min_throughput_per_sec": 171.791,
        },
        "specialist_fanout_64": {
            "max_elapsed_ms": 26.001,
            "max_peak_python_bytes": 249705,
            "min_throughput_per_sec": 2461.469,
        },
        "verification_fanout_64": {
            "max_elapsed_ms": 0.670,
            "max_peak_python_bytes": 21342,
            "min_throughput_per_sec": 95471.660,
        },
        "audit_replay_1k_steps": {
            "max_elapsed_ms": 93.886,
            "max_peak_python_bytes": 1408573,
            "min_throughput_per_sec": 10651.221,
        },
    },
}


EXPECTED_DETAILS: dict[str, dict[str, Any]] = {
    "temporal_evidence_graph_10k": {"evidence_count": 10000, "edge_count": 10000, "verified": True},
    "correlated_scenario_grid_10k_rows": {"variables": 8, "paths": 100, "periods": 100, "scenario_rows": 10000},
    "decision_ledger_3k_events": {"events": 3000},
    "persistent_adaptation_100_releases": {"release_count": 100, "active_after_rollback": "v99", "rollback_target": "v99"},
    "specialist_fanout_64": {"specialists": 64},
    "verification_fanout_64": {"verification_paths": 64, "origin_count": 64},
    "audit_replay_1k_steps": {"status": "PASS", "steps_replayed": 1000},
}


EXPECTED_UNITS: dict[str, int] = {
    "temporal_evidence_graph_10k": 10000,
    "correlated_scenario_grid_10k_rows": 10000,
    "decision_ledger_3k_events": 3000,
    "persistent_adaptation_100_releases": 100,
    "specialist_fanout_64": 64,
    "verification_fanout_64": 64,
    "audit_replay_1k_steps": 1000,
}


def derived_budgets() -> dict[str, dict[str, float | int]]:
    policy = BASELINE_CONTRACT["policy"]
    out: dict[str, dict[str, float | int]] = {}
    for name, observed in BASELINE_CONTRACT["observed_worst"].items():
        out[name] = {
            "max_elapsed_ms": math.ceil(
                observed["max_elapsed_ms"] * policy["elapsed_multiplier"]
                + policy["elapsed_fixed_margin_ms"]
            ),
            "max_peak_python_bytes": math.ceil(
                observed["max_peak_python_bytes"] * policy["memory_multiplier"]
                + policy["memory_fixed_margin_bytes"]
            ),
            "min_throughput_per_sec": max(
                1,
                math.floor(
                    observed["min_throughput_per_sec"]
                    * policy["minimum_throughput_fraction"]
                ),
            ),
        }
    return out


def contract_fingerprint() -> str:
    return sha256(BASELINE_CONTRACT)


def gate(
    evidence: Mapping[str, Any],
    *,
    workload_git_blob_sha: str,
) -> dict[str, Any]:
    reasons: list[str] = []
    if evidence.get("schema") != "musitu.axiom.review-safe-scale-evidence.v1":
        reasons.append("evidence_schema_mismatch")
    if workload_git_blob_sha != BASELINE_CONTRACT["workload_git_blob_sha"]:
        reasons.append("workload_definition_changed_rebaseline_required")

    environment = evidence.get("environment", {})
    expected_environment = BASELINE_CONTRACT["environment"]
    if environment.get("python") != expected_environment["python"]:
        reasons.append("python_version_mismatch")
    if environment.get("implementation") != expected_environment["implementation"]:
        reasons.append("python_implementation_mismatch")
    if environment.get("machine") != expected_environment["machine"]:
        reasons.append("machine_architecture_mismatch")

    rows = evidence.get("benchmarks")
    if not isinstance(rows, list):
        reasons.append("benchmark_rows_missing")
        rows = []
    by_name: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not isinstance(row, Mapping) or not row.get("name"):
            reasons.append("malformed_benchmark_row")
            continue
        name = str(row["name"])
        if name in by_name:
            reasons.append("duplicate_benchmark:" + name)
            continue
        by_name[name] = row

    expected_names = set(EXPECTED_UNITS)
    actual_names = set(by_name)
    if actual_names != expected_names:
        reasons.append("benchmark_set_mismatch")

    budgets = derived_budgets()
    checks: dict[str, Any] = {}
    for name in sorted(expected_names):
        row = by_name.get(name)
        if row is None:
            checks[name] = {"status": "FAIL", "reasons": ["benchmark_missing"]}
            continue
        local_reasons: list[str] = []
        if row.get("units") != EXPECTED_UNITS[name]:
            local_reasons.append("workload_units_changed")
        details = row.get("details")
        if not isinstance(details, Mapping):
            local_reasons.append("benchmark_details_missing")
            details = {}
        for key, expected in EXPECTED_DETAILS[name].items():
            if details.get(key) != expected:
                local_reasons.append("detail_mismatch:" + key)

        budget = budgets[name]
        try:
            elapsed = float(row["elapsed_ms"])
            peak = int(row["peak_python_bytes"])
            throughput = float(row["throughput_per_sec"])
        except (KeyError, TypeError, ValueError):
            local_reasons.append("measurement_missing_or_invalid")
            elapsed = float("inf")
            peak = 2**63 - 1
            throughput = 0.0

        if elapsed > float(budget["max_elapsed_ms"]):
            local_reasons.append("elapsed_budget_exceeded")
        if peak > int(budget["max_peak_python_bytes"]):
            local_reasons.append("memory_budget_exceeded")
        if throughput < float(budget["min_throughput_per_sec"]):
            local_reasons.append("throughput_budget_missed")
        if local_reasons:
            reasons.extend(f"{name}:{reason}" for reason in local_reasons)
        checks[name] = {
            "status": "PASS" if not local_reasons else "FAIL",
            "reasons": local_reasons,
            "observed": {
                "elapsed_ms": elapsed,
                "peak_python_bytes": peak,
                "throughput_per_sec": throughput,
            },
            "budget": budget,
        }

    return {
        "status": "PASS" if not reasons else "FAIL",
        "scope": BASELINE_CONTRACT["scope"],
        "reasons": sorted(set(reasons)),
        "baseline_candidate_sha": BASELINE_CONTRACT["baseline_candidate_sha"],
        "baseline_evidence_sha256": list(BASELINE_CONTRACT["evidence_sha256"]),
        "baseline_contract_sha256": contract_fingerprint(),
        "candidate_sha": evidence.get("candidate_sha"),
        "candidate_evidence_sha256": evidence.get("evidence_sha256"),
        "workload_git_blob_sha": workload_git_blob_sha,
        "checks": checks,
    }


def _load(path: str | Path) -> Mapping[str, Any]:
    with Path(path).open(encoding="utf-8") as f:
        value = json.load(f)
    if not isinstance(value, Mapping):
        raise ValueError("scale evidence must be a JSON object")
    return value


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print("usage: python -m frontier_review_safe.scale_budget <evidence.json> <workload_git_blob_sha>", file=sys.stderr)
        return 2
    report = gate(_load(args[0]), workload_git_blob_sha=args[1])
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
