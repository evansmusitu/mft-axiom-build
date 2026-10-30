#!/usr/bin/env python3
"""Behavior contract for OPS-003 provider circuit breakers and degradation."""
from __future__ import annotations

try:
    from frontier_v5.runtime.circuit_breakers import (
        CircuitBreakerFabric,
        CircuitBreakerPolicy,
        NoHealthyProviderError,
        UnknownProviderError,
    )
except ModuleNotFoundError as exc:  # explicit TDD red phase
    raise AssertionError("OPS-003 circuit-breaker runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def policy() -> CircuitBreakerPolicy:
    return CircuitBreakerPolicy(
        failure_threshold=3,
        failure_window_seconds=60,
        open_seconds=30,
        probe_lease_seconds=10,
        recovery_successes=2,
        timeout_penalty=30,
        error_penalty=20,
        success_reward=20,
        minimum_health_score=40,
    )


def main() -> None:
    fabric = CircuitBreakerFabric(
        {
            "primary": policy(),
            "fallback": policy(),
        }
    )

    # Healthy provider is used normally and provider state is isolated.
    first = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-healthy",
        now_epoch=100,
    )
    assert first["provider"] == "primary"
    assert first["mode"] == "normal"
    assert first["probe"] is False
    assert first["health_score"] == 100
    assert fabric.health("fallback", now_epoch=100)["health_score"] == 100

    # A timeout/error storm must open only the affected provider. The exact
    # threshold is deliberately frozen so implementation cannot hide failures
    # behind an ever-moving heuristic.
    fabric.record_failure(
        "primary", request_id="req-fail-1", now_epoch=101, kind="timeout"
    )
    fabric.record_failure(
        "primary", request_id="req-fail-2", now_epoch=102, kind="error"
    )
    opened = fabric.record_failure(
        "primary", request_id="req-fail-3", now_epoch=103, kind="timeout"
    )
    assert opened["state"] == "open"
    assert opened["health_score"] < 40
    assert opened["open_until_epoch"] == 133

    fallback_health = fabric.health("fallback", now_epoch=103)
    assert fallback_health["state"] == "closed"
    assert fallback_health["health_score"] == 100

    # Degraded mode must route away from an open preferred provider without
    # pretending the request is healthy/normal.
    degraded = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-degraded",
        now_epoch=104,
    )
    assert degraded["provider"] == "fallback"
    assert degraded["mode"] == "degraded"
    assert degraded["preferred_provider"] == "primary"
    assert degraded["probe"] is False

    # Once the cooldown expires, exactly one half-open probe may enter. A
    # concurrent request must not join it (thundering-herd prevention) and must
    # degrade to the fallback instead.
    probe1 = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-probe-1",
        now_epoch=133,
    )
    assert probe1["provider"] == "primary"
    assert probe1["mode"] == "recovery_probe"
    assert probe1["probe"] is True

    concurrent = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-concurrent",
        now_epoch=133,
    )
    assert concurrent["provider"] == "fallback"
    assert concurrent["mode"] == "degraded"
    assert fabric.health("primary", now_epoch=133)["probe_inflight"] is True

    # Recovery requires two successful probe cycles. One success alone cannot
    # prematurely close the breaker.
    one = fabric.record_success(
        "primary", request_id="req-probe-1", now_epoch=134, latency_ms=120
    )
    assert one["state"] == "half_open"
    assert one["recovery_successes"] == 1
    assert one["probe_inflight"] is False

    probe2 = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-probe-2",
        now_epoch=135,
    )
    assert probe2["mode"] == "recovery_probe"
    two = fabric.record_success(
        "primary", request_id="req-probe-2", now_epoch=136, latency_ms=110
    )
    assert two["state"] == "closed"
    assert two["recovery_successes"] == 0
    assert two["probe_inflight"] is False
    assert two["health_score"] >= 40

    restored = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-restored",
        now_epoch=137,
    )
    assert restored["provider"] == "primary"
    assert restored["mode"] == "normal"

    # Probe failure must immediately re-open instead of leaking traffic.
    for idx, t in enumerate((140, 141, 142), start=1):
        fabric.record_failure(
            "primary", request_id=f"req-second-storm-{idx}", now_epoch=t, kind="error"
        )
    retry_probe = fabric.route(
        preferred="primary",
        fallbacks=("fallback",),
        request_id="req-probe-fails",
        now_epoch=172,
    )
    assert retry_probe["probe"] is True
    failed_probe = fabric.record_failure(
        "primary", request_id="req-probe-fails", now_epoch=173, kind="timeout"
    )
    assert failed_probe["state"] == "open"
    assert failed_probe["open_until_epoch"] == 203

    # If every candidate is unavailable, routing must fail closed. Unknown
    # providers must also be rejected rather than silently added.
    for idx, t in enumerate((174, 175, 176), start=1):
        fabric.record_failure(
            "fallback", request_id=f"req-fallback-fail-{idx}", now_epoch=t, kind="timeout"
        )
    expect_raises(
        NoHealthyProviderError,
        lambda: fabric.route(
            preferred="primary",
            fallbacks=("fallback",),
            request_id="req-none-healthy",
            now_epoch=177,
        ),
        "no healthy provider",
    )
    expect_raises(
        UnknownProviderError,
        lambda: fabric.health("not-configured", now_epoch=177),
        "unknown provider",
    )

    print("MUSITU_AXIOM_FRONTIER_CIRCUIT_BREAKER_PASS")


if __name__ == "__main__":
    main()
