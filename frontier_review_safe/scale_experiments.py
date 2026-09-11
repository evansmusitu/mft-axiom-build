from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import perf_counter
from typing import Any, Callable, Mapping
import json
import os
import platform
import tracemalloc

from .core import ContradictionResolver, Evidence, FrontierSafetyError, sha256
from .evaluation import DecisionProvenanceLedger
from .orchestration import (
    CostLatencyQualityRouter,
    ProviderState,
    SpecialistContract,
    SpecialistResult,
    SpecialistSociety,
)


SCHEMA = "musitu.axiom.review-safe-scale-experiments.v1"
PROMOTION_STATUS = "MEASUREMENT_ONLY_UNBUDGETED"
FIXED_TIME = "2026-09-11T00:00:00+00:00"
EXPECTED_NAMES = frozenset({
    "router_degraded_pool_512x2000",
    "contradiction_resolution_10k",
    "specialist_retry_storm_64",
    "concurrent_ledger_1k_16_workers",
})


def _measure(name: str, units: int, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    tracemalloc.start()
    started = perf_counter()
    details = fn()
    elapsed = max(perf_counter() - started, 1e-9)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "name": name,
        "units": units,
        "elapsed_ms": round(elapsed * 1000.0, 3),
        "throughput_per_sec": round(units / elapsed, 3),
        "peak_python_bytes": int(peak),
        "budget_eligible": False,
        "details": details,
    }


def _router_degraded_pool() -> dict[str, Any]:
    provider_count = 512
    route_count = 2_000
    now = datetime.fromisoformat(FIXED_TIME)
    circuit_until = (now + timedelta(hours=1)).isoformat()
    providers = []
    for i in range(provider_count):
        providers.append(ProviderState(
            name=f"provider-{i:04d}",
            quality=.72 + (i % 25) / 100.0,
            calibration=.70 + (i % 20) / 100.0,
            reliability=.75 + (i % 20) / 100.0,
            latency_ms=20.0 + (i % 80),
            cost_units=(i % 10) / 10.0,
            healthy=(i % 4 != 0),
            consecutive_failures=i % 4,
            circuit_open_until=circuit_until if i % 7 == 0 else None,
            policy_allowed=(i % 5 != 0),
        ))
    router = CostLatencyQualityRouter(providers)

    def workload() -> dict[str, Any]:
        selected: dict[str, int] = {}
        for i in range(route_count):
            result = router.route(
                FIXED_TIME,
                min_quality=.75 + (i % 5) / 100.0,
                max_latency_ms=90.0,
                max_cost_units=.8,
            )
            name = result["provider"].name
            selected[name] = selected.get(name, 0) + 1
        return {
            "providers": provider_count,
            "route_decisions": route_count,
            "provider_evaluations": provider_count * route_count,
            "selected_provider_count": len(selected),
            "selection_sha256": sha256(selected),
            "degradation_families": ["unhealthy", "policy_denied", "circuit_open", "failure_penalty"],
        }

    return _measure("router_degraded_pool_512x2000", provider_count * route_count, workload)


def _contradiction_resolution() -> dict[str, Any]:
    count = 10_000
    values = ("A", "B", "C", "D", "E")
    items = []
    for i in range(count):
        items.append(Evidence(
            evidence_id=f"contradiction-{i:05d}",
            claim="benchmark_claim",
            value=values[i % len(values)],
            source_id=f"source-{i:05d}",
            observed_at=FIXED_TIME,
            confidence=.65 + (i % 30) / 100.0,
            primary=(i % 11 == 0),
            authority=.60 + (i % 35) / 100.0,
            methodological_rigor=.62 + (i % 30) / 100.0,
            provenance_integrity=.95,
            recency_score=.90,
            correction_risk=(i % 5) / 100.0,
            conflict_risk=(i % 7) / 100.0,
            independence_group=f"dependency-{i % 1_000:04d}",
        ))

    def workload() -> dict[str, Any]:
        result = ContradictionResolver.resolve(items, minimum_margin=.08, minimum_support=.35)
        ranked = result.get("ranked", [])
        return {
            "evidence_items": count,
            "candidate_values": len(values),
            "declared_dependency_groups": 1_000,
            "status": result["status"],
            "minority_value_count": len(result.get("minority_evidence", [])),
            "ranked_value_count": len(ranked) if ranked else len(values),
            "result_sha256": sha256(result),
        }

    return _measure("contradiction_resolution_10k", count, workload)


def _specialist_retry_storm() -> dict[str, Any]:
    specialist_count = 64
    attempts: dict[str, int] = {}
    lock = Lock()
    handlers = {}
    contracts = []

    for i in range(specialist_count):
        name = f"retry-specialist-{i:02d}"
        lane = f"retry-lane-{i:02d}"

        def make_handler(specialist: str, independent_lane: str):
            def handler(task: Mapping[str, Any]) -> SpecialistResult:
                with lock:
                    attempt = attempts.get(specialist, 0) + 1
                    attempts[specialist] = attempt
                if attempt == 1:
                    raise RuntimeError("synthetic transient benchmark failure")
                return SpecialistResult(
                    specialist,
                    independent_lane,
                    task["value"],
                    .85,
                    ("benchmark-evidence",),
                )
            return handler

        handlers[name] = make_handler(name, lane)
        contracts.append(SpecialistContract(name, "benchmark", lane, 1.0, 1, 1.0))

    society = SpecialistSociety(handlers)

    def workload() -> dict[str, Any]:
        result = society.deliberate(
            contracts,
            {"value": 42},
            total_budget_units=float(specialist_count),
        )
        if result.get("status") != "OK":
            raise FrontierSafetyError("retry-storm benchmark did not recover")
        expected_calls = specialist_count * 2
        actual_calls = sum(attempts.values())
        if actual_calls != expected_calls:
            raise FrontierSafetyError("retry-storm benchmark did not execute exactly one retry per specialist")
        return {
            "specialists": specialist_count,
            "handler_calls": actual_calls,
            "retries_observed": actual_calls - specialist_count,
            "failures_after_retry": len(result.get("failures", [])),
            "trace_sha256": result["trace_sha256"],
        }

    return _measure("specialist_retry_storm_64", specialist_count * 2, workload)


def _concurrent_ledger() -> dict[str, Any]:
    event_count = 1_000
    workers = 16

    def workload() -> dict[str, Any]:
        ledger = DecisionProvenanceLedger()

        def append_one(i: int) -> str:
            return ledger.append(
                "benchmark.concurrent-decision",
                f"worker-{i % workers}",
                {"index": i},
                request_id=f"concurrent-{i:05d}",
                policy_version="bench-policy-v1",
                code_version="bench-code-v1",
                input_hashes=[sha256({"input": i})],
            )

        with ThreadPoolExecutor(max_workers=workers) as pool:
            hashes = list(pool.map(append_one, range(event_count)))
        ledger.verify()
        if len(ledger.events) != event_count or len(set(hashes)) != event_count:
            raise FrontierSafetyError("concurrent ledger lost or duplicated an event")
        return {
            "events": len(ledger.events),
            "workers": workers,
            "unique_event_hashes": len(set(hashes)),
            "ledger_fingerprint": ledger.fingerprint,
        }

    return _measure("concurrent_ledger_1k_16_workers", event_count, workload)


def run_all() -> dict[str, Any]:
    experiments = [
        _router_degraded_pool(),
        _contradiction_resolution(),
        _specialist_retry_storm(),
        _concurrent_ledger(),
    ]
    evidence = {
        "schema": SCHEMA,
        "promotion_status": PROMOTION_STATUS,
        "claim_boundary": "raw internal measurements only; no SLO, scale, frontier, or superiority claim authorized",
        "candidate_sha": os.environ.get("GITHUB_SHA", "LOCAL_UNBOUND"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
        },
        "experiments": experiments,
    }
    evidence["evidence_sha256"] = sha256(evidence)
    return evidence


def validate_experimental_evidence(evidence: Mapping[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    if evidence.get("schema") != SCHEMA:
        reasons.append("schema_mismatch")
    if evidence.get("promotion_status") != PROMOTION_STATUS:
        reasons.append("promotion_status_mismatch")
    rows = evidence.get("experiments")
    if not isinstance(rows, list):
        reasons.append("experiments_missing")
        rows = []
    names = {str(row.get("name")) for row in rows if isinstance(row, Mapping)}
    if names != EXPECTED_NAMES:
        reasons.append("experiment_set_mismatch")
    for row in rows:
        if not isinstance(row, Mapping):
            reasons.append("malformed_experiment")
            continue
        if row.get("budget_eligible") is not False:
            reasons.append("experiment_incorrectly_budget_eligible")
        try:
            if int(row["units"]) <= 0:
                reasons.append("nonpositive_units")
            if float(row["elapsed_ms"]) < 0:
                reasons.append("negative_elapsed")
            if float(row["throughput_per_sec"]) <= 0:
                reasons.append("nonpositive_throughput")
            if int(row["peak_python_bytes"]) < 0:
                reasons.append("negative_memory")
        except (KeyError, TypeError, ValueError):
            reasons.append("invalid_measurement")
    if len(str(evidence.get("evidence_sha256", ""))) != 64:
        reasons.append("evidence_hash_missing")
    return {
        "status": "PASS" if not reasons else "FAIL",
        "promotion_status": PROMOTION_STATUS,
        "reasons": sorted(set(reasons)),
        "experiment_count": len(rows),
        "budget_authorized": False,
        "claim_authorized": False,
    }


def main() -> int:
    evidence = run_all()
    validation = validate_experimental_evidence(evidence)
    if validation["status"] != "PASS":
        raise SystemExit(json.dumps(validation, sort_keys=True))
    print(json.dumps(evidence, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
