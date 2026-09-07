#!/usr/bin/env python3
"""Frozen QLT-004 contract for bounded latency percentile instrumentation."""
from __future__ import annotations

import math

try:
    from frontier_v5.runtime.latency_performance import (
        LatencyPerformanceError,
        LatencyPerformanceMonitor,
    )
except ModuleNotFoundError as exc:  # explicit behavioral RED phase
    raise AssertionError("QLT-004 latency-performance runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def main() -> None:
    monitor = LatencyPerformanceMonitor(
        max_samples_per_series=128,
        max_series_per_dimension=8,
        default_min_samples=20,
    )

    # Internal SLOs are dimension-scoped. No production/customer SLA is implied.
    for dimension, name in (
        ("tool", "company-analyze"),
        ("workflow", "company-research"),
        ("model", "reasoning-primary"),
    ):
        configured = monitor.set_internal_slo(
            dimension,
            name,
            p95_target_ms=90.0,
            p99_target_ms=100.0,
            min_samples=20,
        )
        assert configured["dimension"] == dimension
        assert configured["name"] == name
        assert configured["scope"] == "internal"

    # Representative requests populate tool/workflow/model series from the same
    # low-cardinality event without storing prompts, outputs, credentials, or URLs.
    for value in range(1, 101):
        event = monitor.record_latency(
            request_id=f"req-{value}",
            latency_ms=float(value),
            tool_id="company-analyze",
            workflow_id="company-research",
            model_id="reasoning-primary",
        )
        assert event["replayed"] is False
        assert event["recorded_dimensions"] == ["tool", "workflow", "model"]

    # Exact retries are idempotent; conflicting retries fail closed.
    replay = monitor.record_latency(
        request_id="req-1",
        latency_ms=1.0,
        tool_id="company-analyze",
        workflow_id="company-research",
        model_id="reasoning-primary",
    )
    assert replay["replayed"] is True
    expect_raises(
        LatencyPerformanceError,
        lambda: monitor.record_latency(
            request_id="req-1",
            latency_ms=999.0,
            tool_id="company-analyze",
            workflow_id="company-research",
            model_id="reasoning-primary",
        ),
        "idempotency",
    )

    # Nearest-rank percentiles over 1..100 are deterministic.
    for dimension, name in (
        ("tool", "company-analyze"),
        ("workflow", "company-research"),
        ("model", "reasoning-primary"),
    ):
        report = monitor.evaluate(dimension, name)
        assert report["sample_count"] == 100
        assert report["p50_ms"] == 50.0
        assert report["p95_ms"] == 95.0
        assert report["p99_ms"] == 99.0
        assert report["slo_state"] == "violating"
        assert report["violations"] == ["p95"]
        assert report["scope"] == "internal"

    # Insufficient evidence must be explicit rather than falsely healthy.
    monitor.set_internal_slo(
        "tool", "fast-tool", p95_target_ms=50.0, p99_target_ms=80.0, min_samples=5
    )
    for idx, value in enumerate((10.0, 20.0, 30.0), start=1):
        monitor.record_latency(
            request_id=f"fast-{idx}", latency_ms=value, tool_id="fast-tool"
        )
    small = monitor.evaluate("tool", "fast-tool")
    assert small["sample_count"] == 3
    assert small["slo_state"] == "insufficient_samples"

    # Samples are bounded per series; the oldest observations are evicted.
    bounded = LatencyPerformanceMonitor(
        max_samples_per_series=5,
        max_series_per_dimension=4,
        default_min_samples=1,
    )
    bounded.set_internal_slo(
        "tool", "bounded-tool", p95_target_ms=10.0, p99_target_ms=10.0
    )
    for value in range(1, 8):
        bounded.record_latency(
            request_id=f"bounded-{value}",
            latency_ms=float(value),
            tool_id="bounded-tool",
        )
    bounded_report = bounded.evaluate("tool", "bounded-tool")
    assert bounded_report["sample_count"] == 5
    assert bounded_report["p50_ms"] == 5.0
    assert bounded_report["p95_ms"] == 7.0
    assert bounded_report["p99_ms"] == 7.0

    # Invalid durations and unsupported/high-cardinality dimensions fail closed.
    for bad in (-1.0, math.nan, math.inf):
        expect_raises(
            LatencyPerformanceError,
            lambda bad=bad: monitor.record_latency(
                request_id=f"bad-{repr(bad)}",
                latency_ms=bad,
                tool_id="company-analyze",
            ),
            "latency",
        )
    expect_raises(
        LatencyPerformanceError,
        lambda: monitor.set_internal_slo(
            "service", "not-supported", p95_target_ms=1.0, p99_target_ms=2.0
        ),
        "dimension",
    )

    cardinality = LatencyPerformanceMonitor(
        max_samples_per_series=8,
        max_series_per_dimension=2,
        default_min_samples=1,
    )
    for idx in range(2):
        cardinality.record_latency(
            request_id=f"series-{idx}", latency_ms=1.0, tool_id=f"tool-{idx}"
        )
    expect_raises(
        LatencyPerformanceError,
        lambda: cardinality.record_latency(
            request_id="series-overflow", latency_ms=1.0, tool_id="tool-2"
        ),
        "cardinality",
    )

    # The API intentionally accepts no raw prompt/output fields.
    try:
        monitor.record_latency(
            request_id="secret-payload",
            latency_ms=1.0,
            tool_id="company-analyze",
            prompt="must-not-be-stored",  # type: ignore[call-arg]
        )
    except TypeError:
        pass
    else:
        raise AssertionError("latency API unexpectedly accepted raw prompt content")

    print("MUSITU_AXIOM_FRONTIER_LATENCY_PERFORMANCE_PASS")


if __name__ == "__main__":
    main()
