"""Source-specific freshness policy and stale-data handling for Frontier v5.

Freshness is evaluated from a source's own ``as_of`` timestamp.  Retrieval time
is retained as provenance only and can never launder old source data into a
fresh result.  The module is deterministic: callers provide the evaluation time
and all emitted evidence is derived from validated inputs and the frozen policy.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Mapping


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class FreshnessError(RuntimeError):
    """Base error for freshness policy failures."""


class StaleDataError(FreshnessError):
    """Raised when policy requires stale material data to be rejected."""


class FutureDataError(FreshnessError):
    """Raised when source chronology exceeds the permitted clock skew."""


class UnknownSourceClassError(FreshnessError):
    """Raised when no explicit freshness policy exists for a source class."""


def _parse_aware(value: str, *, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty ISO-8601 timestamp")
    text = value.strip()
    try:
        # ``fromisoformat`` does not accept every spelling of UTC on older
        # Python versions, so normalize Z without changing stored evidence.
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ValueError(f"{field} must be a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} timestamp must include a timezone")
    return parsed


def _seconds(value: float) -> int | float:
    return int(value) if value.is_integer() else value


@dataclass(frozen=True)
class FreshnessPolicy:
    max_age_seconds: int
    stale_action: str
    max_future_skew_seconds: int

    def __post_init__(self) -> None:
        for name in ("max_age_seconds", "max_future_skew_seconds"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a non-negative integer")
        if self.stale_action not in {"reject", "annotate"}:
            raise ValueError("stale_action must be 'reject' or 'annotate'")


@dataclass(frozen=True)
class FreshnessObservation:
    source_id: str
    source_class: str
    as_of: str
    retrieved_at: str
    sha256: str

    def __post_init__(self) -> None:
        for name in ("source_id", "source_class"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty string")
        _parse_aware(self.as_of, field="as_of")
        _parse_aware(self.retrieved_at, field="retrieved_at")
        if not isinstance(self.sha256, str) or not _SHA256.fullmatch(self.sha256):
            raise ValueError("sha256 must be a lowercase 64-hex digest")


@dataclass(frozen=True)
class FreshnessDecision:
    source_id: str
    source_class: str
    as_of: str
    retrieved_at: str
    sha256: str
    evaluated_at: str
    age_seconds: int | float
    ttl_seconds: int
    is_stale: bool
    action: str
    annotation: str | None

    def evidence(self) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "source_class": self.source_class,
            "as_of": self.as_of,
            "retrieved_at": self.retrieved_at,
            "sha256": self.sha256,
            "evaluated_at": self.evaluated_at,
            "age_seconds": self.age_seconds,
            "ttl_seconds": self.ttl_seconds,
            "is_stale": self.is_stale,
            "action": self.action,
            "annotation": self.annotation,
        }


class FreshnessGuard:
    """Evaluate observations against explicit source-class freshness policies."""

    def __init__(self, policies: Mapping[str, FreshnessPolicy]) -> None:
        if not policies:
            raise ValueError("at least one source freshness policy is required")
        normalized: dict[str, FreshnessPolicy] = {}
        for source_class, policy in policies.items():
            if not isinstance(source_class, str) or not source_class.strip():
                raise ValueError("source class names must be non-empty strings")
            if not isinstance(policy, FreshnessPolicy):
                raise TypeError(f"policy for {source_class!r} must be FreshnessPolicy")
            name = source_class.strip()
            if name in normalized:
                raise ValueError(f"duplicate source class: {name}")
            normalized[name] = policy
        self._policies = normalized

    def evaluate(self, observation: FreshnessObservation, *, now: str) -> FreshnessDecision:
        if not isinstance(observation, FreshnessObservation):
            raise TypeError("observation must be FreshnessObservation")
        try:
            policy = self._policies[observation.source_class]
        except KeyError as exc:
            raise UnknownSourceClassError(
                f"unknown source class: {observation.source_class}"
            ) from exc

        evaluated = _parse_aware(now, field="now")
        as_of = _parse_aware(observation.as_of, field="as_of")
        retrieved_at = _parse_aware(observation.retrieved_at, field="retrieved_at")

        source_future_seconds = (as_of - evaluated).total_seconds()
        if source_future_seconds > policy.max_future_skew_seconds:
            raise FutureDataError(
                f"source as_of is {source_future_seconds:g}s in the future for "
                f"{observation.source_class}; maximum skew is "
                f"{policy.max_future_skew_seconds}s"
            )

        retrieval_future_seconds = (retrieved_at - evaluated).total_seconds()
        if retrieval_future_seconds > policy.max_future_skew_seconds:
            raise FutureDataError(
                f"retrieved_at is {retrieval_future_seconds:g}s in the future for "
                f"{observation.source_class}; maximum skew is "
                f"{policy.max_future_skew_seconds}s"
            )

        age = (evaluated - as_of).total_seconds()
        age_value = _seconds(age)
        stale = age > policy.max_age_seconds

        if stale and policy.stale_action == "reject":
            raise StaleDataError(
                f"stale {observation.source_class} data rejected: source "
                f"{observation.source_id} as_of {observation.as_of} is "
                f"{age_value}s old; TTL is {policy.max_age_seconds}s"
            )

        annotation: str | None = None
        action = "accept"
        if stale:
            action = "annotate"
            annotation = (
                f"STALE {observation.source_class} data: source {observation.source_id}; "
                f"as_of={observation.as_of}; age_seconds={age_value}; "
                f"ttl_seconds={policy.max_age_seconds}"
            )

        return FreshnessDecision(
            source_id=observation.source_id,
            source_class=observation.source_class,
            as_of=observation.as_of,
            retrieved_at=observation.retrieved_at,
            sha256=observation.sha256,
            evaluated_at=now,
            age_seconds=age_value,
            ttl_seconds=policy.max_age_seconds,
            is_stale=stale,
            action=action,
            annotation=annotation,
        )
