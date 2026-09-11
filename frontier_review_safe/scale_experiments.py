from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import perf_counter
from typing import Any, Callable, Mapping
import json
import math
import os
import platform
import tracemalloc

from .core import Evidence, FrontierSafetyError, sha256
from .evidence_resolution import ContradictionResolver
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
AUDIT_GROWTH_NAME = "audit_log_growth_10k_events"
AUDIT_GROWTH_CHECKPOINTS = (1_000, 5_000, 10_000)
EXPECTED_NAMES = frozenset({
    "router_degraded_pool_512x2000",
    "contradiction_resolution_10k",
    "specialist_retry_storm_64",
    "concurrent_ledger_1k_16_workers",
    AUDIT_GROWTH_NAME,
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
        group = i % 1_000
        cycle = i // 1_000
        # 100 dependency families intentionally drift across values over cycles;
        # 900 remain internally consistent. The hardened resolver must quarantine
        # the conflicted components instead of lending their weight to both sides.
        value_index = (i + cycle) % len(values) if group < 100 else i % len(values)
        items.append(Evidence(
            evidence_id=f"contradiction-{i:05d}",
            claim="benchmark_claim",
            value=values[value_index],
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
            independence_group=f"dependency-{group:04d}",
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
            "ranked_value_count": len(ranked),
            "dependency_component_count": result["dependency_component_count"],
            "internally_conflicted_component_count": result["internally_conflicted_component_count"],
            "usable_component_count": result["usable_component_count"],
            "discarded_correlated_items": result["discarded_correlated_items"],
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


def _audit_log_growth() -> dict[str, Any]:
    event_count = AUDIT_GROWTH_CHECKPOINTS[-1]
    checkpoint_targets = set(AUDIT_GROWTH_CHECKPOINTS)

    def serialized_size(ledger: DecisionProvenanceLedger) -> int:
        payload = {"schema": ledger.SCHEMA, "events": ledger.events}
        return len(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))

    def workload() -> dict[str, Any]:
        ledger = DecisionProvenanceLedger()
        checkpoint_bytes: dict[str, int] = {}
        for i in range(event_count):
            ledger.append(
                "benchmark.audit-growth",
                "storage-benchmark",
                {"index": i, "bucket": i % 128, "retained": True},
                request_id=f"audit-growth-{i:05d}",
                policy_version="bench-policy-v1",
                code_version="bench-code-v1",
                input_hashes=[sha256({"audit-input": i})],
            )
            count = i + 1
            if count in checkpoint_targets:
                checkpoint_bytes[str(count)] = serialized_size(ledger)

        ledger.verify()
        if len(ledger.events) != event_count:
            raise FrontierSafetyError("audit growth benchmark lost events")
        observed_sizes = [checkpoint_bytes[str(count)] for count in AUDIT_GROWTH_CHECKPOINTS]
        if any(later <= earlier for earlier, later in zip(observed_sizes, observed_sizes[1:])):
            raise FrontierSafetyError("audit storage growth checkpoints are not strictly increasing")
        final_bytes = observed_sizes[-1]
        return {
            "events": event_count,
            "checkpoint_serialized_bytes": checkpoint_bytes,
            "serialized_bytes": final_bytes,
            "bytes_per_event": round(final_bytes / event_count, 3),
            "growth_ratio_10k_vs_1k": round(observed_sizes[-1] / observed_sizes[0], 3),
            "chain_verified": True,
            "ledger_fingerprint": ledger.fingerprint,
        }

    return _measure(AUDIT_GROWTH_NAME, event_count, workload)


def run_all() -> dict[str, Any]:
    experiments = [
        _router_degraded_pool(),
        _contradiction_resolution(),
        _specialist_retry_storm(),
        _concurrent_ledger(),
        _audit_log_growth(),
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


def _valid_audit_growth_details(details: Any) -> bool:
    if not isinstance(details, Mapping):
        return False
    try:
        events = details["events"]
        serialized_bytes = details["serialized_bytes"]
        bytes_per_event = float(details["bytes_per_event"])
        growth_ratio = float(details["growth_ratio_10k_vs_1k"])
        checkpoints = details["checkpoint_serialized_bytes"]
        chain_verified = details["chain_verified"]
        fingerprint = str(details["ledger_fingerprint"])
    except (KeyError, TypeError, ValueError):
        return False
    if events != AUDIT_GROWTH_CHECKPOINTS[-1] or chain_verified is not True:
        return False
    if not isinstance(serialized_bytes, int) or isinstance(serialized_bytes, bool) or serialized_bytes <= 0:
        return False
    if not math.isfinite(bytes_per_event) or bytes_per_event <= 0.0:
        return False
    if not math.isfinite(growth_ratio) or growth_ratio <= 1.0:
        return False
    if not isinstance(checkpoints, Mapping) or set(checkpoints) != {str(x) for x in AUDIT_GROWTH_CHECKPOINTS}:
        return False
    sizes = []
    for checkpoint in AUDIT_GROWTH_CHECKPOINTS:
        value = checkpoints.get(str(checkpoint))
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            return False
        sizes.append(value)
    if sizes[-1] != serialized_bytes or any(later <= earlier for earlier, later in zip(sizes, sizes[1:])):
        return False
    return len(fingerprint) == 64 and all(c in "0123456789abcdef" for c in fingerprint.lower())


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
    if names != EXPECTED_NAMES or len(rows) != len(EXPECTED_NAMES):
        reasons.append("experiment_set_mismatch")
    for row in rows:
        if not isinstance(row, Mapping):
            reasons.append("malformed_experiment")
            continue
        if row.get("budget_eligible") is not False:
            reasons.append("experiment_incorrectly_budget_eligible")
        try:
            units = row["units"]
            elapsed = float(row["elapsed_ms"])
            throughput = float(row["throughput_per_sec"])
            peak = row["peak_python_bytes"]
            if not isinstance(units, int) or isinstance(units, bool) or units <= 0:
                reasons.append("nonpositive_or_invalid_units")
            if not math.isfinite(elapsed) or elapsed < 0.0:
                reasons.append("invalid_elapsed")
            if not math.isfinite(throughput) or throughput <= 0.0:
                reasons.append("invalid_throughput")
            if not isinstance(peak, int) or isinstance(peak, bool) or peak < 0:
                reasons.append("invalid_memory")
        except (KeyError, TypeError, ValueError):
            reasons.append("invalid_measurement")
        if row.get("name") == AUDIT_GROWTH_NAME and not _valid_audit_growth_details(row.get("details")):
            reasons.append("audit_growth_details_invalid")

    supplied_hash = str(evidence.get("evidence_sha256", ""))
    if len(supplied_hash) != 64 or any(c not in "0123456789abcdef" for c in supplied_hash.lower()):
        reasons.append("evidence_hash_missing_or_invalid")
    else:
        hash_body = dict(evidence)
        hash_body.pop("evidence_sha256", None)
        if sha256(hash_body) != supplied_hash:
            reasons.append("evidence_hash_mismatch")

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
