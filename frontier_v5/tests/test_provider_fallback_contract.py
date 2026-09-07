#!/usr/bin/env python3
"""Behavior contract for OPS-004 provider-outage and quality-preserving fallback.

All adapters in this test are deterministic fixtures. They prove the internal
routing contract only; they are not evidence of real external providers or
production failover.
"""
from __future__ import annotations

try:
    from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric, CircuitBreakerPolicy
    from frontier_v5.runtime.provider_fallback import (
        NoViableProviderError,
        ProviderDescriptor,
        ProviderFallbackRouter,
        ProviderRequest,
        ProviderResponse,
        ProviderTimeoutError,
    )
except ModuleNotFoundError as exc:  # explicit TDD red phase
    raise AssertionError("OPS-004 provider-fallback runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def breaker_policy() -> CircuitBreakerPolicy:
    return CircuitBreakerPolicy(
        failure_threshold=2,
        failure_window_seconds=60,
        open_seconds=30,
        probe_lease_seconds=10,
        recovery_successes=1,
        timeout_penalty=35,
        error_penalty=25,
        success_reward=20,
        minimum_health_score=30,
    )


class FixtureAdapter:
    """Deterministic internal adapter fixture; never represents a real provider."""

    def __init__(self, descriptor: ProviderDescriptor, outcomes: list[object]) -> None:
        self.descriptor = descriptor
        self._outcomes = list(outcomes)
        self.calls = 0

    def execute(self, request: ProviderRequest) -> ProviderResponse:
        self.calls += 1
        if not self._outcomes:
            raise AssertionError(f"fixture {self.descriptor.provider_id} exhausted")
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        assert isinstance(outcome, ProviderResponse)
        return outcome


def descriptor(
    provider_id: str,
    *,
    jurisdictions: frozenset[str] = frozenset({"ZW", "US"}),
    quality: float = 0.90,
    latency_ms: int = 250,
    cost_units: float = 2.0,
) -> ProviderDescriptor:
    return ProviderDescriptor(
        provider_id=provider_id,
        domains=frozenset({"finance"}),
        modalities=frozenset({"text"}),
        required_scopes=frozenset({"axiom.execute"}),
        allowed_jurisdictions=jurisdictions,
        policy_tags=frozenset({"no-secret-egress", "evidence-required"}),
        advertised_quality=quality,
        advertised_latency_ms=latency_ms,
        advertised_cost_units=cost_units,
        verified=True,
    )


def request() -> ProviderRequest:
    return ProviderRequest(
        domain="finance",
        modality="text",
        available_scopes=frozenset({"axiom.execute"}),
        jurisdiction="ZW",
        min_quality=0.80,
        max_latency_ms=500,
        max_cost_units=5.0,
        required_policy_tags=frozenset({"no-secret-egress", "evidence-required"}),
    )


def response(provider_id: str, *, quality: float, latency_ms: int, cost_units: float, value: str) -> ProviderResponse:
    return ProviderResponse(
        provider_id=provider_id,
        output={"answer": value},
        quality_score=quality,
        latency_ms=latency_ms,
        cost_units=cost_units,
        policy_tags=frozenset({"no-secret-egress", "evidence-required"}),
    )


def make_breakers() -> CircuitBreakerFabric:
    return CircuitBreakerFabric({"primary": breaker_policy(), "fallback": breaker_policy()})


def main() -> None:
    # The router must require genuinely distinct adapter identities. Two aliases
    # to one identity are not independent provider fallback.
    one = FixtureAdapter(descriptor("primary"), [response("primary", quality=0.9, latency_ms=100, cost_units=1, value="x")])
    expect_raises(
        ValueError,
        lambda: ProviderFallbackRouter([one], CircuitBreakerFabric({"primary": breaker_policy()})),
        "at least two distinct providers",
    )

    # Primary timeout must fall through to a distinct provider without relaxing
    # quality, policy, latency, cost, scope, or jurisdiction requirements.
    primary = FixtureAdapter(descriptor("primary"), [ProviderTimeoutError("fixture timeout")])
    fallback = FixtureAdapter(
        descriptor("fallback", quality=0.88, latency_ms=300, cost_units=2.5),
        [response("fallback", quality=0.86, latency_ms=280, cost_units=2.4, value="fallback-ok")],
    )
    breakers = make_breakers()
    router = ProviderFallbackRouter([primary, fallback], breakers)
    result = router.execute(
        request(), preferred="primary", request_id="req-outage", now_epoch=100
    )
    assert result.provider_id == "fallback"
    assert result.mode == "degraded"
    assert result.response.output == {"answer": "fallback-ok"}
    assert [x.provider_id for x in result.attempts] == ["primary", "fallback"]
    assert result.attempts[0].outcome == "timeout"
    assert result.attempts[1].outcome == "accepted"
    assert result.effective_min_quality == 0.80
    assert result.effective_policy_tags == frozenset({"no-secret-egress", "evidence-required"})
    assert breakers.health("primary", now_epoch=100)["health_score"] == 65

    # A response that is available but below the observed quality floor is also
    # a degradation event; it may not be returned merely because transport was
    # healthy. The fallback must still satisfy the original floor.
    primary2 = FixtureAdapter(
        descriptor("primary"),
        [response("primary", quality=0.55, latency_ms=120, cost_units=1.0, value="low-quality")],
    )
    fallback2 = FixtureAdapter(
        descriptor("fallback"),
        [response("fallback", quality=0.84, latency_ms=210, cost_units=2.0, value="quality-ok")],
    )
    breakers2 = make_breakers()
    quality_result = ProviderFallbackRouter([primary2, fallback2], breakers2).execute(
        request(), preferred="primary", request_id="req-quality", now_epoch=200
    )
    assert quality_result.provider_id == "fallback"
    assert quality_result.mode == "degraded"
    assert quality_result.attempts[0].outcome == "quality_below_floor"
    assert quality_result.response.quality_score >= 0.80

    # Observed latency/cost overruns must also trigger fallback. Advertised
    # compliance alone is insufficient.
    primary3 = FixtureAdapter(
        descriptor("primary"),
        [response("primary", quality=0.92, latency_ms=900, cost_units=1.0, value="too-slow")],
    )
    fallback3 = FixtureAdapter(
        descriptor("fallback"),
        [response("fallback", quality=0.85, latency_ms=250, cost_units=3.0, value="within-budget")],
    )
    budget_result = ProviderFallbackRouter([primary3, fallback3], make_breakers()).execute(
        request(), preferred="primary", request_id="req-budget", now_epoch=300
    )
    assert budget_result.provider_id == "fallback"
    assert budget_result.attempts[0].outcome == "latency_budget_exceeded"
    assert budget_result.response.latency_ms <= 500
    assert budget_result.response.cost_units <= 5.0

    # An adapter incompatible with policy/jurisdiction must never receive the
    # request. Routing must skip it rather than weakening policy.
    incompatible = FixtureAdapter(
        descriptor("primary", jurisdictions=frozenset({"US"})),
        [response("primary", quality=0.99, latency_ms=10, cost_units=0.1, value="must-not-run")],
    )
    compatible = FixtureAdapter(
        descriptor("fallback", jurisdictions=frozenset({"ZW"})),
        [response("fallback", quality=0.83, latency_ms=200, cost_units=2.0, value="policy-ok")],
    )
    policy_result = ProviderFallbackRouter([incompatible, compatible], make_breakers()).execute(
        request(), preferred="primary", request_id="req-policy", now_epoch=400
    )
    assert incompatible.calls == 0
    assert compatible.calls == 1
    assert policy_result.provider_id == "fallback"
    assert policy_result.attempts[0].outcome == "ineligible_policy"

    # Repeated failure opens the OPS-003 breaker. Subsequent requests must skip
    # the open provider instead of repeatedly hammering it.
    storm_primary = FixtureAdapter(
        descriptor("primary"),
        [ProviderTimeoutError("one"), ProviderTimeoutError("two")],
    )
    storm_fallback = FixtureAdapter(
        descriptor("fallback"),
        [
            response("fallback", quality=0.85, latency_ms=200, cost_units=2.0, value="a"),
            response("fallback", quality=0.85, latency_ms=200, cost_units=2.0, value="b"),
            response("fallback", quality=0.85, latency_ms=200, cost_units=2.0, value="c"),
        ],
    )
    storm_breakers = make_breakers()
    storm_router = ProviderFallbackRouter([storm_primary, storm_fallback], storm_breakers)
    storm_router.execute(request(), preferred="primary", request_id="storm-1", now_epoch=500)
    storm_router.execute(request(), preferred="primary", request_id="storm-2", now_epoch=501)
    assert storm_breakers.health("primary", now_epoch=501)["state"] == "open"
    before = storm_primary.calls
    skipped = storm_router.execute(request(), preferred="primary", request_id="storm-3", now_epoch=502)
    assert storm_primary.calls == before
    assert skipped.provider_id == "fallback"
    assert skipped.attempts[0].outcome == "breaker_unavailable"

    # If every provider either violates the frozen request envelope or returns
    # sub-floor results, fail closed. Never return a lower-quality answer just
    # to preserve availability.
    bad_primary = FixtureAdapter(
        descriptor("primary"),
        [response("primary", quality=0.40, latency_ms=100, cost_units=1, value="bad")],
    )
    bad_fallback = FixtureAdapter(
        descriptor("fallback"),
        [response("fallback", quality=0.50, latency_ms=100, cost_units=1, value="also-bad")],
    )
    expect_raises(
        NoViableProviderError,
        lambda: ProviderFallbackRouter([bad_primary, bad_fallback], make_breakers()).execute(
            request(), preferred="primary", request_id="req-none", now_epoch=600
        ),
        "no provider satisfied",
    )

    print("MUSITU_AXIOM_FRONTIER_PROVIDER_FALLBACK_PASS")


if __name__ == "__main__":
    main()
