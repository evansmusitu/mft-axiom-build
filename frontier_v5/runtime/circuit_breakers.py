"""Provider-aware circuit breakers for Frontier v5 operational resilience.

The fabric is intentionally deterministic and side-effect free outside its in-memory
state. Callers supply the event timestamp so behavior can be replayed exactly in
contract tests and production evidence collectors.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from threading import RLock
from typing import Iterable, Mapping


class CircuitBreakerError(RuntimeError):
    """Base error for circuit-breaker routing failures."""


class UnknownProviderError(CircuitBreakerError):
    """Raised when a caller references a provider that was not configured."""


class NoHealthyProviderError(CircuitBreakerError):
    """Raised when every configured candidate is unavailable or unhealthy."""


@dataclass(frozen=True)
class CircuitBreakerPolicy:
    failure_threshold: int
    failure_window_seconds: int
    open_seconds: int
    probe_lease_seconds: int
    recovery_successes: int
    timeout_penalty: int
    error_penalty: int
    success_reward: int
    minimum_health_score: int

    def __post_init__(self) -> None:
        positive = {
            "failure_threshold": self.failure_threshold,
            "failure_window_seconds": self.failure_window_seconds,
            "open_seconds": self.open_seconds,
            "probe_lease_seconds": self.probe_lease_seconds,
            "recovery_successes": self.recovery_successes,
            "timeout_penalty": self.timeout_penalty,
            "error_penalty": self.error_penalty,
            "success_reward": self.success_reward,
        }
        for name, value in positive.items():
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if (
            not isinstance(self.minimum_health_score, int)
            or isinstance(self.minimum_health_score, bool)
            or not 0 <= self.minimum_health_score <= 100
        ):
            raise ValueError("minimum_health_score must be an integer from 0 to 100")


@dataclass
class _ProviderState:
    state: str = "closed"
    health_score: int = 100
    failure_epochs: list[float] = field(default_factory=list)
    open_until_epoch: float | None = None
    probe_request_id: str | None = None
    probe_lease_until_epoch: float | None = None
    recovery_successes: int = 0


class CircuitBreakerFabric:
    """Isolated per-provider breaker state with fail-closed fallback routing."""

    def __init__(self, policies: Mapping[str, CircuitBreakerPolicy]) -> None:
        if not policies:
            raise ValueError("at least one provider policy is required")
        self._policies: dict[str, CircuitBreakerPolicy] = {}
        self._states: dict[str, _ProviderState] = {}
        for provider, policy in policies.items():
            if not isinstance(provider, str) or not provider.strip():
                raise ValueError("provider names must be non-empty strings")
            if not isinstance(policy, CircuitBreakerPolicy):
                raise TypeError(f"policy for {provider!r} must be CircuitBreakerPolicy")
            name = provider.strip()
            if name in self._policies:
                raise ValueError(f"duplicate provider: {name}")
            self._policies[name] = policy
            self._states[name] = _ProviderState()
        self._lock = RLock()

    def _require_provider(self, provider: str) -> tuple[CircuitBreakerPolicy, _ProviderState]:
        try:
            return self._policies[provider], self._states[provider]
        except (KeyError, TypeError) as exc:
            raise UnknownProviderError(f"unknown provider: {provider}") from exc

    @staticmethod
    def _validate_request_id(request_id: str) -> None:
        if not isinstance(request_id, str) or not request_id.strip():
            raise ValueError("request_id must be a non-empty string")

    @staticmethod
    def _validate_epoch(now_epoch: float) -> float:
        if isinstance(now_epoch, bool) or not isinstance(now_epoch, (int, float)):
            raise TypeError("now_epoch must be numeric")
        return float(now_epoch)

    @staticmethod
    def _display_epoch(value: float | None) -> int | float | None:
        if value is None:
            return None
        return int(value) if value.is_integer() else value

    def _prune_failures(
        self, policy: CircuitBreakerPolicy, state: _ProviderState, now: float
    ) -> None:
        lower_bound = now - policy.failure_window_seconds
        state.failure_epochs = [t for t in state.failure_epochs if t >= lower_bound]

    def _clear_probe(self, state: _ProviderState) -> None:
        state.probe_request_id = None
        state.probe_lease_until_epoch = None

    def _refresh(
        self, policy: CircuitBreakerPolicy, state: _ProviderState, now: float
    ) -> None:
        self._prune_failures(policy, state, now)
        if (
            state.state == "open"
            and state.open_until_epoch is not None
            and now >= state.open_until_epoch
        ):
            state.state = "half_open"
            self._clear_probe(state)
            state.recovery_successes = 0
        if (
            state.state == "half_open"
            and state.probe_lease_until_epoch is not None
            and now >= state.probe_lease_until_epoch
        ):
            # An abandoned recovery probe cannot hold the breaker forever.
            self._clear_probe(state)

    def _open(
        self, policy: CircuitBreakerPolicy, state: _ProviderState, now: float
    ) -> None:
        state.state = "open"
        state.open_until_epoch = now + policy.open_seconds
        state.recovery_successes = 0
        self._clear_probe(state)

    def _snapshot(
        self, provider: str, policy: CircuitBreakerPolicy, state: _ProviderState, now: float
    ) -> dict[str, object]:
        self._refresh(policy, state, now)
        probe_inflight = (
            state.probe_request_id is not None
            and state.probe_lease_until_epoch is not None
            and now < state.probe_lease_until_epoch
        )
        return {
            "provider": provider,
            "state": state.state,
            "health_score": state.health_score,
            "recent_failures": len(state.failure_epochs),
            "open_until_epoch": self._display_epoch(state.open_until_epoch),
            "probe_inflight": probe_inflight,
            "recovery_successes": state.recovery_successes,
        }

    def health(self, provider: str, *, now_epoch: float) -> dict[str, object]:
        now = self._validate_epoch(now_epoch)
        with self._lock:
            policy, state = self._require_provider(provider)
            return self._snapshot(provider, policy, state, now)

    @staticmethod
    def _dedupe_candidates(preferred: str, fallbacks: Iterable[str]) -> list[str]:
        ordered: list[str] = []
        for provider in (preferred, *tuple(fallbacks)):
            if provider not in ordered:
                ordered.append(provider)
        return ordered

    def route(
        self,
        *,
        preferred: str,
        fallbacks: Iterable[str] = (),
        request_id: str,
        now_epoch: float,
    ) -> dict[str, object]:
        """Choose an eligible provider or fail closed when none can safely serve."""
        self._validate_request_id(request_id)
        now = self._validate_epoch(now_epoch)
        candidates = self._dedupe_candidates(preferred, fallbacks)
        if not candidates:
            raise NoHealthyProviderError("no healthy provider is configured")

        with self._lock:
            # Reject configuration errors before mutating any half-open lease.
            for provider in candidates:
                self._require_provider(provider)

            for index, provider in enumerate(candidates):
                policy, state = self._require_provider(provider)
                self._refresh(policy, state, now)

                if state.state == "closed":
                    if state.health_score < policy.minimum_health_score:
                        continue
                    return {
                        "provider": provider,
                        "preferred_provider": preferred,
                        "mode": "normal" if index == 0 else "degraded",
                        "probe": False,
                        "health_score": state.health_score,
                    }

                if state.state == "open":
                    continue

                if state.state == "half_open":
                    if state.probe_request_id is not None:
                        continue
                    # Lease assignment occurs while holding the fabric lock, so
                    # only one in-process request can become the recovery probe.
                    state.probe_request_id = request_id
                    state.probe_lease_until_epoch = now + policy.probe_lease_seconds
                    return {
                        "provider": provider,
                        "preferred_provider": preferred,
                        "mode": "recovery_probe",
                        "probe": True,
                        "health_score": state.health_score,
                    }

                raise CircuitBreakerError(
                    f"invalid circuit-breaker state for {provider}: {state.state}"
                )

        raise NoHealthyProviderError(
            "no healthy provider available for request " + request_id
        )

    def record_failure(
        self,
        provider: str,
        *,
        request_id: str,
        now_epoch: float,
        kind: str,
    ) -> dict[str, object]:
        """Apply a timeout/error failure and open on a frozen-window storm."""
        self._validate_request_id(request_id)
        now = self._validate_epoch(now_epoch)
        if kind not in {"timeout", "error"}:
            raise ValueError("failure kind must be 'timeout' or 'error'")

        with self._lock:
            policy, state = self._require_provider(provider)
            self._refresh(policy, state, now)
            penalty = policy.timeout_penalty if kind == "timeout" else policy.error_penalty
            state.health_score = max(0, state.health_score - penalty)
            state.failure_epochs.append(now)
            self._prune_failures(policy, state, now)

            if state.state == "half_open":
                # Only the leased recovery probe may change half-open recovery
                # state. A late/unrelated request is evidence of failure but may
                # not steal or resolve another request's lease.
                if state.probe_request_id == request_id:
                    self._open(policy, state, now)
            elif state.state == "closed":
                if len(state.failure_epochs) >= policy.failure_threshold:
                    self._open(policy, state, now)
            # Failures arriving from requests that began before an OPEN decision
            # do not extend the cooldown, preventing a tail of late responses
            # from keeping the provider open indefinitely.

            return self._snapshot(provider, policy, state, now)

    def record_success(
        self,
        provider: str,
        *,
        request_id: str,
        now_epoch: float,
        latency_ms: float,
    ) -> dict[str, object]:
        """Reward success and close only after the required recovery probes."""
        self._validate_request_id(request_id)
        now = self._validate_epoch(now_epoch)
        if isinstance(latency_ms, bool) or not isinstance(latency_ms, (int, float)):
            raise TypeError("latency_ms must be numeric")
        if latency_ms < 0:
            raise ValueError("latency_ms cannot be negative")

        with self._lock:
            policy, state = self._require_provider(provider)
            self._refresh(policy, state, now)

            if state.state == "half_open":
                if state.probe_request_id != request_id:
                    # Stale successes cannot close a breaker or resolve another
                    # request's recovery lease.
                    return self._snapshot(provider, policy, state, now)
                state.health_score = min(100, state.health_score + policy.success_reward)
                state.recovery_successes += 1
                self._clear_probe(state)
                if state.recovery_successes >= policy.recovery_successes:
                    state.state = "closed"
                    state.open_until_epoch = None
                    state.failure_epochs.clear()
                    state.recovery_successes = 0
                return self._snapshot(provider, policy, state, now)

            if state.state == "closed":
                state.health_score = min(100, state.health_score + policy.success_reward)
                return self._snapshot(provider, policy, state, now)

            # A late success from a request that began before OPEN cannot bypass
            # the cooldown or fabricate recovery.
            return self._snapshot(provider, policy, state, now)
