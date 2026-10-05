from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from typing import Any, Callable
import json
import os
import platform
import tracemalloc

from .adaptation import PersistentContinualAdaptationRegistry
from .analysis import ScenarioFactory, ShockVariable
from .core import Evidence, TemporalEdge, TemporalEvidenceGraph, canonical, sha256
from .evaluation import AdaptationRelease, DecisionProvenanceLedger
from .orchestration import SpecialistContract, SpecialistResult, SpecialistSociety
from .replay import AuditReplayBundle, AuditReplayEngine, ReplayOperation, ReplayStep
from .verification import IndependentVerifier, VerificationPath


FIXED_TIME = "2026-09-11T00:00:00+00:00"


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
        "details": details,
    }


def _temporal_graph() -> dict[str, Any]:
    count = 10_000

    def workload() -> dict[str, Any]:
        graph = TemporalEvidenceGraph()
        for i in range(count):
            evidence_id = f"e-{i:05d}"
            graph.add_evidence(Evidence(
                evidence_id=evidence_id,
                claim="stress_metric",
                value=i,
                source_id=f"source-{i % 97}",
                observed_at=FIXED_TIME,
                confidence=.9,
                primary=(i % 3 == 0),
                authority=.8,
                methodological_rigor=.8,
                provenance_integrity=1.0,
                recency_score=1.0,
                independence_group=f"group-{i % 503}",
            ))
            graph.add_edge(TemporalEdge(
                subject="BENCH",
                predicate="stress_metric",
                value=i,
                valid_from=FIXED_TIME,
                valid_to=None,
                evidence_id=evidence_id,
                recorded_at=FIXED_TIME,
            ))
        rows = graph.as_of("BENCH", "stress_metric", FIXED_TIME)
        verified = graph.verify()
        return {
            "evidence_count": count,
            "edge_count": len(rows),
            "verified": verified,
            "graph_fingerprint": graph.fingerprint,
        }

    return _measure("temporal_evidence_graph_10k", count, workload)


def _scenario_grid() -> dict[str, Any]:
    variables = [ShockVariable(f"v{i}", 0.0, 1.0 + i / 10.0) for i in range(8)]
    correlation = [[1.0 if i == j else 0.15 for j in range(8)] for i in range(8)]
    paths, periods = 100, 100

    def workload() -> dict[str, Any]:
        generated = ScenarioFactory.correlated_paths(
            variables, correlation, periods=periods, paths=paths, seed=20260911
        )
        return {
            "variables": len(variables),
            "paths": len(generated),
            "periods": len(generated[0]),
            "scenario_rows": paths * periods,
            "result_sha256": sha256(generated),
        }

    return _measure("correlated_scenario_grid_10k_rows", paths * periods, workload)


def _decision_ledger() -> dict[str, Any]:
    count = 3_000

    def workload() -> dict[str, Any]:
        ledger = DecisionProvenanceLedger()
        for i in range(count):
            ledger.append(
                "benchmark.decision",
                "benchmark-principal",
                {"index": i, "decision": i % 7},
                request_id=f"bench-{i:05d}",
                policy_version="bench-policy-v1",
                code_version="bench-code-v1",
                input_hashes=[sha256({"input": i})],
            )
        ledger.verify()
        serialized_bytes = len(canonical({"schema": ledger.SCHEMA, "events": ledger.events}).encode("utf-8"))
        return {
            "events": len(ledger.events),
            "serialized_bytes": serialized_bytes,
            "bytes_per_event": round(serialized_bytes / max(1, len(ledger.events)), 3),
            "ledger_fingerprint": ledger.fingerprint,
        }

    return _measure("decision_ledger_3k_events", count, workload)


def _persistent_adaptation() -> dict[str, Any]:
    count = 100

    def workload() -> dict[str, Any]:
        with TemporaryDirectory() as td:
            path = Path(td) / "adaptation.json"
            registry = PersistentContinualAdaptationRegistry(path)
            parent = None
            for i in range(count):
                version = f"v{i + 1}"
                release = AdaptationRelease(
                    version=version,
                    parent_version=parent,
                    failure_corpus_hash=sha256({"failure": i}),
                    calibration_hash=sha256({"calibration": i}),
                    routing_policy_hash=sha256({"routing": i}),
                    eval_hash=sha256({"eval": i}),
                    rollback_to=parent,
                )
                registry.promote(release, regression_pass=True)
                parent = version
            file_bytes = path.stat().st_size
            restarted = PersistentContinualAdaptationRegistry(path)
            rollback_target = restarted.rollback()
            reloaded = PersistentContinualAdaptationRegistry(path)
            return {
                "release_count": len(reloaded.releases),
                "active_after_rollback": reloaded.active_version,
                "rollback_target": rollback_target,
                "persisted_bytes": file_bytes,
                "registry_fingerprint": reloaded.fingerprint,
            }

    return _measure("persistent_adaptation_100_releases", count, workload)


def _specialist_fanout() -> dict[str, Any]:
    count = 64
    handlers = {}
    contracts = []
    for i in range(count):
        name = f"specialist-{i:02d}"
        lane = f"lane-{i:02d}"
        handlers[name] = (
            lambda specialist=name, independent_lane=lane:
            (lambda task: SpecialistResult(
                specialist, independent_lane, task["value"] + 1, .9, ("evidence",)
            ))
        )()
        contracts.append(SpecialistContract(name, "benchmark", lane, 1.0, 0, 1.0))
    society = SpecialistSociety(handlers)

    def workload() -> dict[str, Any]:
        result = society.deliberate(contracts, {"value": 41}, total_budget_units=float(count))
        if result.get("status") != "OK":
            raise RuntimeError("specialist fan-out did not complete")
        return {
            "specialists": len(result["outputs"]),
            "confidence": result["confidence"],
            "trace_sha256": result["trace_sha256"],
        }

    return _measure("specialist_fanout_64", count, workload)


def _verification_fanout() -> dict[str, Any]:
    count = 64
    provenance = sha256({"receipt": "benchmark-only"})
    paths = tuple(
        VerificationPath(
            verifier_id=f"v-{i:02d}",
            method=f"method-{i:02d}",
            independent_provider=None,
            check=lambda result: result.get("value") == 42,
            origin=f"benchmark-origin-{i:02d}",
            provenance_hash=provenance,
            requires_external_origin=False,
        )
        for i in range(count)
    )

    def workload() -> dict[str, Any]:
        result = IndependentVerifier.verify({"value": 42}, paths, minimum_independent_paths=count)
        if result.get("status") != "PASS":
            raise RuntimeError("verification fan-out did not complete")
        return {
            "verification_paths": len(result["checks"]),
            "origin_count": len(result["independent_origins"]),
            "result_sha256": result["result_sha256"],
        }

    return _measure("verification_fanout_64", count, workload)


def _audit_replay() -> dict[str, Any]:
    count = 1_000
    initial = {"v0": 0}
    initial_hashes = {"v0": sha256(0)}
    steps = []
    for i in range(count):
        input_name = f"v{i}"
        output_name = f"v{i + 1}"
        steps.append(ReplayStep(
            step_id=f"s-{i:04d}",
            operation_id="increment",
            operation_version="1.0",
            input_names=(input_name,),
            output_name=output_name,
            expected_output_hash=sha256(i + 1),
        ))
    bundle = AuditReplayBundle(
        bundle_id="scale-replay-v1",
        created_at=FIXED_TIME,
        code_version="bench-code-v1",
        policy_version="bench-policy-v1",
        assumptions=("integer increment is deterministic",),
        initial_values=initial,
        initial_hashes=initial_hashes,
        steps=tuple(steps),
        result_name=f"v{count}",
        expected_result_hash=sha256(count),
    )
    operations = {
        "increment": ReplayOperation(
            "increment", "1.0", lambda values: next(iter(values.values())) + 1
        )
    }

    def workload() -> dict[str, Any]:
        result = AuditReplayEngine.replay(bundle, operations)
        return result

    return _measure("audit_replay_1k_steps", count, workload)


def run_all() -> dict[str, Any]:
    benchmarks = [
        _temporal_graph(),
        _scenario_grid(),
        _decision_ledger(),
        _persistent_adaptation(),
        _specialist_fanout(),
        _verification_fanout(),
        _audit_replay(),
    ]
    evidence = {
        "schema": "musitu.axiom.review-safe-scale-evidence.v1",
        "candidate_sha": os.environ.get("GITHUB_SHA", "LOCAL_UNBOUND"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "machine": platform.machine(),
        },
        "benchmarks": benchmarks,
    }
    evidence["evidence_sha256"] = sha256(evidence)
    return evidence


def main() -> int:
    print(json.dumps(run_all(), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
