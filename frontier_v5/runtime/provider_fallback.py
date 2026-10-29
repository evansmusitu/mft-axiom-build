"""Policy-preserving provider fallback for Frontier v5.

This module provides internal execution semantics only.  Provider descriptors and
adapters are caller-supplied; the module does not claim that any external
provider is configured, reachable, independent, or production-verified.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Protocol

from frontier_v5.runtime.circuit_breakers import (
    CircuitBreakerFabric,
    NoHealthyProviderError,
)


class ProviderFallbackError(RuntimeError):
    """Base class for provider-fallback execution errors."""


class ProviderTimeoutError(ProviderFallbackError):
    """A provider adapter exceeded its transport/execution timeout."""


class NoViableProviderError(ProviderFallbackError):
    """No provider satisfied the request's unchanged execution envelope."""


@dataclass(frozen=True)
class ProviderDescriptor:
    provider_id: str
    domains: frozenset[str]
    modalities: frozenset[str]
    required_scopes: frozenset[str]
    allowed_jurisdictions: frozenset[str]
    policy_tags: frozenset[str]
    advertised_quality: float
    advertised_latency_ms: int
    advertised_cost_units: float
    verified: bool

    def __post_init__(self) -> None:
        if not isinstance(self.provider_id, str) or not self.provider_id.strip():
            raise ValueError("provider_id must be a non-empty string")
        for name in (
            "domains",
            "modalities",
            "required_scopes",
            "allowed_jurisdictions",
            "policy_tags",
        ):
            value = getattr(self, name)
            if not isinstance(value, frozenset) or not all(
                isinstance(item, str) and item for item in value
            ):
                raise ValueError(f"{name} must be a frozenset of non-empty strings")
        if isinstance(self.advertised_quality, bool) or not isinstance(
            self.advertised_quality, (int, float)
        ):
            raise TypeError("advertised_quality must be numeric")
        if not 0.0 <= float(self.advertised_quality) <= 1.0:
            raise ValueError("advertised_quality must be between 0 and 1")
        if isinstance(self.advertised_latency_ms, bool) or not isinstance(
            self.advertised_latency_ms, int
        ) or self.advertised_latency_ms < 0:
            raise ValueError("advertised_latency_ms must be a non-negative integer")
        if isinstance(self.advertised_cost_units, bool) or not isinstance(
            self.advertised_cost_units, (int, float)
        ) or float(self.advertised_cost_units) < 0:
            raise ValueError("advertised_cost_units must be non-negative")
        if not isinstance(self.verified, bool):
            raise TypeError("verified must be boolean")


@dataclass(frozen=True)
class ProviderRequest:
    domain: str
    modality: str
    available_scopes: frozenset[str]
    jurisdiction: str
    min_quality: float
    max_latency_ms: int
    max_cost_units: float
    required_policy_tags: frozenset[str]

    def __post_init__(self) -> None:
        for name in ("domain", "modality", "jurisdiction"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{name} must be a non-empty string")
        for name in ("available_scopes", "required_policy_tags"):
            value = getattr(self, name)
            if not isinstance(value, frozenset) or not all(
                isinstance(item, str) and item for item in value
            ):
                raise ValueError(f"{name} must be a frozenset of non-empty strings")
        if isinstance(self.min_quality, bool) or not isinstance(
            self.min_quality, (int, float)
        ) or not 0.0 <= float(self.min_quality) <= 1.0:
            raise ValueError("min_quality must be between 0 and 1")
        if isinstance(self.max_latency_ms, bool) or not isinstance(
            self.max_latency_ms, int
        ) or self.max_latency_ms < 0:
            raise ValueError("max_latency_ms must be a non-negative integer")
        if isinstance(self.max_cost_units, bool) or not isinstance(
            self.max_cost_units, (int, float)
        ) or float(self.max_cost_units) < 0:
            raise ValueError("max_cost_units must be non-negative")


@dataclass(frozen=True)
class ProviderResponse:
    provider_id: str
    output: Any
    quality_score: float
    latency_ms: int
    cost_units: float
    policy_tags: frozenset[str]

    def __post_init__(self) -> None:
        if not isinstance(self.provider_id, str) or not self.provider_id:
            raise ValueError("provider_id must be a non-empty string")
        if isinstance(self.quality_score, bool) or not isinstance(
            self.quality_score, (int, float)
        ) or not 0.0 <= float(self.quality_score) <= 1.0:
            raise ValueError("quality_score must be between 0 and 1")
        if isinstance(self.latency_ms, bool) or not isinstance(self.latency_ms, int) or self.latency_ms < 0:
            raise ValueError("latency_ms must be a non-negative integer")
        if isinstance(self.cost_units, bool) or not isinstance(
            self.cost_units, (int, float)
        ) or float(self.cost_units) < 0:
            raise ValueError("cost_units must be non-negative")
        if not isinstance(self.policy_tags, frozenset) or not all(
            isinstance(item, str) and item for item in self.policy_tags
        ):
            raise ValueError("policy_tags must be a frozenset of non-empty strings")


@dataclass(frozen=True)
class ProviderAttempt:
    provider_id: str
    outcome: str


@dataclass(frozen=True)
class ProviderFallbackResult:
    provider_id: str
    mode: str
    response: ProviderResponse
    attempts: tuple[ProviderAttempt, ...]
    effective_min_quality: float
    effective_policy_tags: frozenset[str]


class ProviderAdapter(Protocol):
    descriptor: ProviderDescriptor

    def execute(self, request: ProviderRequest) -> ProviderResponse: ...


class ProviderFallbackRouter:
    """Execute across distinct provider adapters without weakening policy."""

    def __init__(
        self,
        adapters: Iterable[ProviderAdapter],
        breakers: CircuitBreakerFabric,
    ) -> None:
        supplied = list(adapters)
        by_id: dict[str, ProviderAdapter] = {}
        for adapter in supplied:
            descriptor = getattr(adapter, "descriptor", None)
            if not isinstance(descriptor, ProviderDescriptor):
                raise TypeError("every provider adapter must expose ProviderDescriptor")
            provider_id = descriptor.provider_id
            if provider_id in by_id:
                raise ValueError(f"duplicate provider identity: {provider_id}")
            by_id[provider_id] = adapter
        if len(by_id) < 2:
            raise ValueError("at least two distinct providers are required")
        if not isinstance(breakers, CircuitBreakerFabric):
            raise TypeError("breakers must be CircuitBreakerFabric")
        self._adapters = by_id
        self._order = tuple(by_id)
        self._breakers = breakers

    @staticmethod
    def _matches(value: str, allowed: frozenset[str]) -> bool:
        return value in allowed or "*" in allowed

    @classmethod
    def _eligible(cls, descriptor: ProviderDescriptor, request: ProviderRequest) -> bool:
        """Check the frozen envelope before any provider call is allowed."""
        if not descriptor.verified:
            return False
        if not cls._matches(request.domain, descriptor.domains):
            return False
        if not cls._matches(request.modality, descriptor.modalities):
            return False
        if not descriptor.required_scopes.issubset(request.available_scopes):
            return False
        if not cls._matches(request.jurisdiction, descriptor.allowed_jurisdictions):
            return False
        if not request.required_policy_tags.issubset(descriptor.policy_tags):
            return False
        if float(descriptor.advertised_quality) < float(request.min_quality):
            return False
        if descriptor.advertised_latency_ms > request.max_latency_ms:
            return False
        if float(descriptor.advertised_cost_units) > float(request.max_cost_units):
            return False
        return True

    def _ordered_ids(self, preferred: str) -> tuple[str, ...]:
        if preferred not in self._adapters:
            raise ValueError(f"preferred provider is not configured: {preferred}")
        return (preferred,) + tuple(item for item in self._order if item != preferred)

    @staticmethod
    def _observed_outcome(response: ProviderResponse, request: ProviderRequest) -> str | None:
        if not request.required_policy_tags.issubset(response.policy_tags):
            return "policy_mismatch"
        if float(response.quality_score) < float(request.min_quality):
            return "quality_below_floor"
        if response.latency_ms > request.max_latency_ms:
            return "latency_budget_exceeded"
        if float(response.cost_units) > float(request.max_cost_units):
            return "cost_budget_exceeded"
        return None

    def execute(
        self,
        request: ProviderRequest,
        *,
        preferred: str,
        request_id: str,
        now_epoch: float,
    ) -> ProviderFallbackResult:
        if not isinstance(request, ProviderRequest):
            raise TypeError("request must be ProviderRequest")
        if not isinstance(request_id, str) or not request_id.strip():
            raise ValueError("request_id must be a non-empty string")

        attempts: list[ProviderAttempt] = []
        ordered = self._ordered_ids(preferred)

        for provider_id in ordered:
            adapter = self._adapters[provider_id]
            descriptor = adapter.descriptor

            if not self._eligible(descriptor, request):
                attempts.append(ProviderAttempt(provider_id, "ineligible_policy"))
                continue

            try:
                breaker_route = self._breakers.route(
                    preferred=provider_id,
                    fallbacks=(),
                    request_id=request_id,
                    now_epoch=now_epoch,
                )
            except NoHealthyProviderError:
                attempts.append(ProviderAttempt(provider_id, "breaker_unavailable"))
                continue

            try:
                response = adapter.execute(request)
            except ProviderTimeoutError:
                self._breakers.record_failure(
                    provider_id,
                    request_id=request_id,
                    now_epoch=now_epoch,
                    kind="timeout",
                )
                attempts.append(ProviderAttempt(provider_id, "timeout"))
                continue

            if not isinstance(response, ProviderResponse):
                self._breakers.record_failure(
                    provider_id,
                    request_id=request_id,
                    now_epoch=now_epoch,
                    kind="error",
                )
                attempts.append(ProviderAttempt(provider_id, "invalid_response"))
                continue
            if response.provider_id != provider_id:
                self._breakers.record_failure(
                    provider_id,
                    request_id=request_id,
                    now_epoch=now_epoch,
                    kind="error",
                )
                attempts.append(ProviderAttempt(provider_id, "identity_mismatch"))
                continue

            violation = self._observed_outcome(response, request)
            if violation is not None:
                self._breakers.record_failure(
                    provider_id,
                    request_id=request_id,
                    now_epoch=now_epoch,
                    kind="error",
                )
                attempts.append(ProviderAttempt(provider_id, violation))
                continue

            self._breakers.record_success(
                provider_id,
                request_id=request_id,
                now_epoch=now_epoch,
                latency_ms=response.latency_ms,
            )
            attempts.append(ProviderAttempt(provider_id, "accepted"))
            degraded = provider_id != preferred or len(attempts) > 1
            if breaker_route.get("mode") != "normal":
                degraded = True
            return ProviderFallbackResult(
                provider_id=provider_id,
                mode="degraded" if degraded else "normal",
                response=response,
                attempts=tuple(attempts),
                effective_min_quality=request.min_quality,
                effective_policy_tags=request.required_policy_tags,
            )

        attempted = ", ".join(f"{a.provider_id}:{a.outcome}" for a in attempts)
        raise NoViableProviderError(
            "no provider satisfied the unchanged request envelope"
            + (f" ({attempted})" if attempted else "")
        )
