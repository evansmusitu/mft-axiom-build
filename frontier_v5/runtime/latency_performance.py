#!/usr/bin/env python3
"""Bounded internal latency percentile instrumentation for Frontier v5.

This module is intentionally frontier-only. It does not publish customer SLAs,
wire itself to sealed v4 production routing, or retain request/response payloads.
It provides low-cardinality tool/workflow/model latency series that can be
promoted separately after authorized production-equivalent load evidence.
"""
from __future__ import annotations

from collections import OrderedDict, deque
from collections.abc import Mapping
import math
import re
from typing import Any


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$")
_DIMENSIONS = ("tool", "workflow", "model")


class LatencyPerformanceError(RuntimeError):
    """Latency instrumentation input or policy violated the frozen contract."""


def _positive_int(value: Any, name: str) -> int:
    if type(value) is not int or value < 1:
        raise LatencyPerformanceError(f"{name} must be an integer >= 1")
    return value


def _identifier(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise LatencyPerformanceError(f"{name} is required")
    text = value.strip()
    if not text or not _ID.fullmatch(text):
        raise LatencyPerformanceError(f"{name} has invalid format")
    return text


def _duration(value: Any, name: str = "latency_ms") -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise LatencyPerformanceError(f"{name} must be finite numeric latency")
    number = float(value)
    if not math.isfinite(number) or number < 0.0:
        raise LatencyPerformanceError(f"{name} must be finite latency >= 0")
    return number


def _nearest_rank(values: list[float], quantile: float) -> float:
    if not values:
        raise LatencyPerformanceError("latency series has no samples")
    ordered = sorted(values)
    rank = max(1, math.ceil(quantile * len(ordered)))
    return float(ordered[rank - 1])


class LatencyPerformanceMonitor:
    """Low-cardinality bounded latency monitor for internal evidence only."""

    def __init__(
        self,
        *,
        max_samples_per_series: int = 1024,
        max_series_per_dimension: int = 256,
        default_min_samples: int = 20,
    ) -> None:
        self.max_samples_per_series = _positive_int(
            max_samples_per_series, "max_samples_per_series"
        )
        self.max_series_per_dimension = _positive_int(
            max_series_per_dimension, "max_series_per_dimension"
        )
        self.default_min_samples = _positive_int(
            default_min_samples, "default_min_samples"
        )
        self._series: dict[tuple[str, str], deque[float]] = {}
        self._slos: dict[tuple[str, str], dict[str, Any]] = {}
        self._events: OrderedDict[str, tuple[Any, ...]] = OrderedDict()
        # Idempotency state is also bounded. The multiplier allows an event to
        # contribute to all three dimensions without making the ledger unbounded.
        self._max_events = (
            self.max_samples_per_series * self.max_series_per_dimension * len(_DIMENSIONS)
        )

    @staticmethod
    def _dimension(value: Any) -> str:
        if not isinstance(value, str) or value not in _DIMENSIONS:
            raise LatencyPerformanceError(
                "dimension must be one of: tool, workflow, model"
            )
        return value

    def _check_new_series_capacity(self, dimension: str, name: str) -> None:
        key = (dimension, name)
        if key in self._series:
            return
        count = sum(1 for existing_dimension, _ in self._series if existing_dimension == dimension)
        if count >= self.max_series_per_dimension:
            raise LatencyPerformanceError(
                f"{dimension} series cardinality limit reached"
            )

    def set_internal_slo(
        self,
        dimension: str,
        name: str,
        *,
        p95_target_ms: float,
        p99_target_ms: float,
        min_samples: int | None = None,
    ) -> dict[str, Any]:
        dimension = self._dimension(dimension)
        name = _identifier(name, "series name")
        p95 = _duration(p95_target_ms, "p95_target_ms")
        p99 = _duration(p99_target_ms, "p99_target_ms")
        if p99 < p95:
            raise LatencyPerformanceError("p99_target_ms must be >= p95_target_ms")
        minimum = (
            self.default_min_samples
            if min_samples is None
            else _positive_int(min_samples, "min_samples")
        )
        key = (dimension, name)
        self._slos[key] = {
            "dimension": dimension,
            "name": name,
            "p95_target_ms": p95,
            "p99_target_ms": p99,
            "min_samples": minimum,
            "scope": "internal",
        }
        return dict(self._slos[key])

    def record_latency(
        self,
        *,
        request_id: str,
        latency_ms: float,
        tool_id: str | None = None,
        workflow_id: str | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = _identifier(request_id, "request_id")
        latency = _duration(latency_ms)

        supplied = (
            ("tool", tool_id),
            ("workflow", workflow_id),
            ("model", model_id),
        )
        resolved: list[tuple[str, str]] = []
        for dimension, value in supplied:
            if value is not None:
                resolved.append((dimension, _identifier(value, f"{dimension}_id")))
        if not resolved:
            raise LatencyPerformanceError(
                "at least one of tool_id, workflow_id, or model_id is required"
            )

        fingerprint = (
            latency,
            tuple(resolved),
        )
        prior = self._events.get(request_id)
        if prior is not None:
            if prior != fingerprint:
                raise LatencyPerformanceError("request idempotency conflict")
            self._events.move_to_end(request_id)
            return {
                "request_id": request_id,
                "replayed": True,
                "recorded_dimensions": [dimension for dimension, _ in resolved],
            }

        # Validate all cardinality limits before mutating any series so a single
        # event cannot be partially admitted.
        for dimension, name in resolved:
            self._check_new_series_capacity(dimension, name)

        for key in resolved:
            bucket = self._series.get(key)
            if bucket is None:
                bucket = deque(maxlen=self.max_samples_per_series)
                self._series[key] = bucket
            bucket.append(latency)

        self._events[request_id] = fingerprint
        self._events.move_to_end(request_id)
        while len(self._events) > self._max_events:
            self._events.popitem(last=False)

        return {
            "request_id": request_id,
            "replayed": False,
            "recorded_dimensions": [dimension for dimension, _ in resolved],
        }

    def evaluate(self, dimension: str, name: str) -> dict[str, Any]:
        dimension = self._dimension(dimension)
        name = _identifier(name, "series name")
        key = (dimension, name)
        samples = list(self._series.get(key, ()))
        if not samples:
            raise LatencyPerformanceError("latency series has no samples")

        p50 = _nearest_rank(samples, 0.50)
        p95 = _nearest_rank(samples, 0.95)
        p99 = _nearest_rank(samples, 0.99)
        policy = self._slos.get(key)

        violations: list[str] = []
        if policy is None:
            state = "unconfigured"
            minimum = self.default_min_samples
        else:
            minimum = int(policy["min_samples"])
            if len(samples) < minimum:
                state = "insufficient_samples"
            else:
                if p95 > float(policy["p95_target_ms"]):
                    violations.append("p95")
                if p99 > float(policy["p99_target_ms"]):
                    violations.append("p99")
                state = "violating" if violations else "healthy"

        return {
            "dimension": dimension,
            "name": name,
            "sample_count": len(samples),
            "p50_ms": p50,
            "p95_ms": p95,
            "p99_ms": p99,
            "slo_state": state,
            "violations": violations,
            "min_samples": minimum,
            "scope": "internal",
        }

    def snapshot(self) -> Mapping[str, Any]:
        """Return aggregate metadata only; never raw observations or payloads."""
        by_dimension = {
            dimension: sum(1 for key in self._series if key[0] == dimension)
            for dimension in _DIMENSIONS
        }
        return {
            "scope": "internal",
            "dimensions": list(_DIMENSIONS),
            "series_counts": by_dimension,
            "configured_slos": len(self._slos),
            "tracked_event_ids": len(self._events),
            "max_samples_per_series": self.max_samples_per_series,
            "max_series_per_dimension": self.max_series_per_dimension,
        }
