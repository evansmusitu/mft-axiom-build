from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from typing import Any, Callable, Mapping, Sequence
import statistics
import time
import tracemalloc

from .core import sha256


@dataclass(frozen=True)
class PerformanceBudget:
    p50_ms: float
    p95_ms: float
    peak_memory_bytes: int
    minimum_throughput_per_sec: float
    error_rate: float


class PerformanceHarness:
    @staticmethod
    def measure(fn: Callable[[Any], Any], inputs: Sequence[Any], *, concurrency: int = 1) -> dict[str, Any]:
        if not inputs or concurrency <= 0:
            raise ValueError("inputs and positive concurrency required")
        durations, errors = [], []
        tracemalloc.start()
        start = time.perf_counter()

        def run(x):
            t = time.perf_counter()
            try:
                fn(x)
                return (time.perf_counter() - t) * 1000, None
            except Exception as exc:
                return (time.perf_counter() - t) * 1000, type(exc).__name__

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(run, x) for x in inputs]
            for fut in as_completed(futures):
                d, err = fut.result()
                durations.append(d)
                if err: errors.append(err)
        elapsed = max(time.perf_counter() - start, 1e-9)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        durations.sort()
        def q(p):
            idx = min(len(durations) - 1, max(0, int(round((len(durations)-1) * p))))
            return durations[idx]
        report = {"count": len(inputs), "p50_ms": q(.5), "p95_ms": q(.95), "max_ms": max(durations),
                  "throughput_per_sec": len(inputs) / elapsed, "peak_memory_bytes": peak,
                  "error_rate": len(errors) / len(inputs), "error_types": sorted(set(errors)),
                  "concurrency": concurrency}
        report["report_sha256"] = sha256(report)
        return report

    @staticmethod
    def gate(report: Mapping[str, Any], budget: PerformanceBudget) -> dict[str, Any]:
        failures = []
        if float(report["p50_ms"]) > budget.p50_ms: failures.append("p50_ms")
        if float(report["p95_ms"]) > budget.p95_ms: failures.append("p95_ms")
        if int(report["peak_memory_bytes"]) > budget.peak_memory_bytes: failures.append("peak_memory_bytes")
        if float(report["throughput_per_sec"]) < budget.minimum_throughput_per_sec: failures.append("throughput")
        if float(report["error_rate"]) > budget.error_rate: failures.append("error_rate")
        return {"status": "PASS" if not failures else "FAIL", "failures": failures,
                "budget_sha256": sha256(asdict(budget)), "report_sha256": report.get("report_sha256")}
