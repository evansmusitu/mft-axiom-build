from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import timedelta
from pathlib import Path
from threading import RLock
from typing import Any, Mapping, Sequence
import json
import math

from .core import Abstained, FrontierSafetyError, atomic_write, canonical, parse_time, sha256, utcnow

SCHEMA = "musitu.axiom.routing-state.v1"
EVENT_TYPES = frozenset({"OUTCOME", "HEALTH", "POLICY"})


def _valid_hash(value: str | None) -> bool:
    return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


@dataclass(frozen=True)
class ProviderState:
    name: str
    quality: float
    calibration: float
    reliability: float
    latency_ms: float
    cost_units: float
    healthy: bool
    consecutive_failures: int = 0
    circuit_open_until: str | None = None
    policy_allowed: bool = True
    capabilities: frozenset[str] = frozenset()
    jurisdictions: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("provider name required")
        for label, value in (("quality", self.quality), ("calibration", self.calibration), ("reliability", self.reliability)):
            if not math.isfinite(float(value)) or not 0.0 <= float(value) <= 1.0:
                raise ValueError(f"{label} must be finite and in [0,1]")
        if not math.isfinite(float(self.latency_ms)) or self.latency_ms < 0:
            raise ValueError("latency_ms must be finite and non-negative")
        if not math.isfinite(float(self.cost_units)) or self.cost_units < 0:
            raise ValueError("cost_units must be finite and non-negative")
        if self.consecutive_failures < 0:
            raise ValueError("consecutive_failures cannot be negative")
        if self.circuit_open_until:
            parse_time(self.circuit_open_until)

    @property
    def normalized(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "quality": float(self.quality),
            "calibration": float(self.calibration),
            "reliability": float(self.reliability),
            "latency_ms": float(self.latency_ms),
            "cost_units": float(self.cost_units),
            "healthy": bool(self.healthy),
            "consecutive_failures": int(self.consecutive_failures),
            "circuit_open_until": self.circuit_open_until,
            "policy_allowed": bool(self.policy_allowed),
            "capabilities": sorted(self.capabilities),
            "jurisdictions": sorted(self.jurisdictions),
        }

    @property
    def fingerprint(self) -> str:
        return sha256(self.normalized)

    @classmethod
    def from_normalized(cls, row: Mapping[str, Any]) -> "ProviderState":
        return cls(
            name=str(row["name"]), quality=float(row["quality"]), calibration=float(row["calibration"]),
            reliability=float(row["reliability"]), latency_ms=float(row["latency_ms"]),
            cost_units=float(row["cost_units"]), healthy=bool(row["healthy"]),
            consecutive_failures=int(row.get("consecutive_failures", 0)),
            circuit_open_until=(str(row["circuit_open_until"]) if row.get("circuit_open_until") else None),
            policy_allowed=bool(row.get("policy_allowed", True)),
            capabilities=frozenset(str(x) for x in row.get("capabilities", ())),
            jurisdictions=frozenset(str(x) for x in row.get("jurisdictions", ())),
        )


@dataclass(frozen=True)
class RoutingPolicy:
    version: str = "musitu.axiom.routing-policy.v1"
    failure_threshold: int = 3
    circuit_open_seconds: int = 60
    ewma_alpha: float = 0.2
    half_open_penalty: float = 0.10
    max_fallbacks: int = 3

    def __post_init__(self) -> None:
        if not self.version:
            raise ValueError("routing policy version required")
        if self.failure_threshold < 1 or self.circuit_open_seconds < 1 or self.max_fallbacks < 0:
            raise ValueError("invalid routing policy integer bounds")
        if not 0.0 < self.ewma_alpha <= 1.0:
            raise ValueError("ewma_alpha must be in (0,1]")
        if not 0.0 <= self.half_open_penalty <= 1.0:
            raise ValueError("half_open_penalty must be in [0,1]")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


@dataclass(frozen=True)
class CapabilitySelectionObservation:
    request_id: str
    selected: str
    eligible: tuple[str, ...]
    realized_quality: Mapping[str, float]
    realized_latency_ms: Mapping[str, float]
    realized_cost: Mapping[str, float]


class CapabilityDiscoveryOptimizer:
    @staticmethod
    def evaluate(
        observations: Sequence[CapabilitySelectionObservation],
        quality_weight: float = 1.0,
        latency_weight: float = 0.001,
        cost_weight: float = 0.05,
    ) -> dict[str, Any]:
        if not observations:
            raise ValueError("observations required")
        regrets: list[float] = []
        correct = 0
        provider_selected: dict[str, int] = {}
        provider_optimal: dict[str, int] = {}
        for obs in observations:
            if obs.selected not in obs.eligible or not obs.eligible:
                raise FrontierSafetyError("selection outside eligible set")
            missing = [p for p in obs.eligible if p not in obs.realized_quality or p not in obs.realized_latency_ms or p not in obs.realized_cost]
            if missing:
                raise FrontierSafetyError("realized metrics missing for eligible provider")
            utility = {
                p: quality_weight * float(obs.realized_quality[p])
                - latency_weight * float(obs.realized_latency_ms[p])
                - cost_weight * float(obs.realized_cost[p])
                for p in obs.eligible
            }
            if any(not math.isfinite(v) for v in utility.values()):
                raise FrontierSafetyError("non-finite realized routing utility")
            best = sorted(utility, key=lambda p: (-utility[p], p))[0]
            provider_selected[obs.selected] = provider_selected.get(obs.selected, 0) + 1
            provider_optimal[best] = provider_optimal.get(best, 0) + 1
            if obs.selected == best:
                correct += 1
            regrets.append(utility[best] - utility[obs.selected])
        return {
            "selection_accuracy": correct / len(observations),
            "mean_regret": sum(regrets) / len(regrets),
            "max_regret": max(regrets),
            "n": len(observations),
            "selected_counts": provider_selected,
            "optimal_counts": provider_optimal,
            "observations_sha256": sha256([asdict(x) for x in observations]),
        }


class CostLatencyQualityRouter:
    """Feedback-aware router with persistent health/circuit/policy evidence.

    With no persistence path or feedback events, the hot route loop remains a
    simple O(provider_count) selection compatible with the original router.
    """

    def __init__(
        self,
        providers: Sequence[ProviderState],
        path: str | Path | None = None,
        policy: RoutingPolicy | None = None,
    ) -> None:
        if len({p.name for p in providers}) != len(providers):
            raise ValueError("provider names must be unique")
        self.path = Path(path) if path else None
        self.policy = policy or RoutingPolicy()
        self._lock = RLock()
        self._base: dict[str, ProviderState] = {p.name: p for p in providers}
        self._runtime: dict[str, dict[str, Any]] = {p.name: dict(p.normalized) for p in providers}
        self._events: list[dict[str, Any]] = []
        self._outcome_ids: dict[str, str] = {}
        if self.path and self.path.exists():
            self._load(tuple(providers))
        elif self.path:
            self._persist()

    def _load(self, supplied: Sequence[ProviderState]) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if raw.get("schema") != SCHEMA:
            raise FrontierSafetyError("unsupported routing-state schema")
        if raw.get("policy_fingerprint") != self.policy.fingerprint:
            raise FrontierSafetyError("routing policy fingerprint mismatch")
        loaded: dict[str, ProviderState] = {}
        for row in raw.get("providers", []):
            body = dict(row)
            expected = body.pop("_fingerprint", None)
            provider = ProviderState.from_normalized(body)
            if not expected or expected != provider.fingerprint:
                raise FrontierSafetyError("provider registration integrity failure")
            if provider.name in loaded:
                raise FrontierSafetyError("duplicate persisted provider")
            loaded[provider.name] = provider
        if supplied:
            supplied_map = {p.name: p for p in supplied}
            if set(supplied_map) != set(loaded) or any(supplied_map[name] != loaded[name] for name in loaded):
                raise FrontierSafetyError("supplied providers differ from persisted registry")
        self._base = loaded
        self._runtime = {name: dict(p.normalized) for name, p in loaded.items()}
        self._events = list(raw.get("events", []))
        self._outcome_ids = {}
        self.verify()
        for event in self._events:
            self._apply_event(event, replay=True)

    def _persist(self) -> None:
        if not self.path:
            return
        payload = {
            "schema": SCHEMA,
            "policy_fingerprint": self.policy.fingerprint,
            "providers": [
                {**p.normalized, "_fingerprint": p.fingerprint}
                for p in sorted(self._base.values(), key=lambda x: x.name)
            ],
            "events": self._events,
        }
        atomic_write(self.path, canonical(payload))

    def _append_event(self, event_type: str, provider: str, payload: Mapping[str, Any], occurred_at: str) -> str:
        if event_type not in EVENT_TYPES or provider not in self._base:
            raise FrontierSafetyError("invalid routing event")
        parse_time(occurred_at)
        body = {
            "sequence": len(self._events),
            "event_type": event_type,
            "provider": provider,
            "occurred_at": occurred_at,
            "payload": dict(payload),
            "previous_sha256": self._events[-1]["event_sha256"] if self._events else None,
        }
        body["event_sha256"] = sha256(body)
        self._events.append(body)
        self._apply_event(body, replay=False)
        self._persist()
        return body["event_sha256"]

    def _apply_event(self, event: Mapping[str, Any], *, replay: bool) -> None:
        provider = str(event["provider"])
        runtime = self._runtime[provider]
        payload = event["payload"]
        if event["event_type"] == "OUTCOME":
            outcome_id = str(payload["outcome_id"])
            existing = self._outcome_ids.get(outcome_id)
            if existing and existing != event["event_sha256"]:
                raise FrontierSafetyError("duplicate routing outcome id")
            self._outcome_ids[outcome_id] = str(event["event_sha256"])
            alpha = self.policy.ewma_alpha
            success = bool(payload["success"])
            runtime["reliability"] = (1 - alpha) * float(runtime["reliability"]) + alpha * (1.0 if success else 0.0)
            if payload.get("observed_quality") is not None:
                runtime["quality"] = (1 - alpha) * float(runtime["quality"]) + alpha * float(payload["observed_quality"])
            if payload.get("observed_calibration") is not None:
                runtime["calibration"] = (1 - alpha) * float(runtime["calibration"]) + alpha * float(payload["observed_calibration"])
            if payload.get("latency_ms") is not None:
                runtime["latency_ms"] = (1 - alpha) * float(runtime["latency_ms"]) + alpha * float(payload["latency_ms"])
            if payload.get("cost_units") is not None:
                runtime["cost_units"] = (1 - alpha) * float(runtime["cost_units"]) + alpha * float(payload["cost_units"])
            if success:
                runtime["consecutive_failures"] = 0
                runtime["circuit_open_until"] = None
            else:
                runtime["consecutive_failures"] = int(runtime["consecutive_failures"]) + 1
                if runtime["consecutive_failures"] >= self.policy.failure_threshold:
                    opened = parse_time(str(event["occurred_at"])) + timedelta(seconds=self.policy.circuit_open_seconds)
                    runtime["circuit_open_until"] = opened.isoformat()
        elif event["event_type"] == "HEALTH":
            runtime["healthy"] = bool(payload["healthy"])
        elif event["event_type"] == "POLICY":
            runtime["policy_allowed"] = bool(payload["allowed"])

    def record_outcome(
        self,
        provider: str,
        *,
        outcome_id: str,
        success: bool,
        occurred_at: str | None = None,
        latency_ms: float | None = None,
        observed_quality: float | None = None,
        observed_calibration: float | None = None,
        cost_units: float | None = None,
        error_class: str | None = None,
    ) -> str:
        if not outcome_id:
            raise ValueError("outcome_id required")
        for label, value in (("observed_quality", observed_quality), ("observed_calibration", observed_calibration)):
            if value is not None and (not math.isfinite(float(value)) or not 0.0 <= float(value) <= 1.0):
                raise ValueError(f"{label} must be finite and in [0,1]")
        for label, value in (("latency_ms", latency_ms), ("cost_units", cost_units)):
            if value is not None and (not math.isfinite(float(value)) or float(value) < 0.0):
                raise ValueError(f"{label} must be finite and non-negative")
        payload = {
            "outcome_id": outcome_id,
            "success": bool(success),
            "latency_ms": latency_ms,
            "observed_quality": observed_quality,
            "observed_calibration": observed_calibration,
            "cost_units": cost_units,
            "error_class": error_class,
        }
        with self._lock:
            if outcome_id in self._outcome_ids:
                existing = next(e for e in self._events if e.get("event_sha256") == self._outcome_ids[outcome_id])
                if existing["provider"] == provider and existing["payload"] == payload:
                    return str(existing["event_sha256"])
                raise FrontierSafetyError("routing outcome idempotency conflict")
            return self._append_event("OUTCOME", provider, payload, occurred_at or utcnow())

    def set_health(
        self,
        provider: str,
        healthy: bool,
        *,
        source_id: str,
        evidence_hash: str,
        occurred_at: str | None = None,
    ) -> str:
        if not source_id or not _valid_hash(evidence_hash):
            raise ValueError("health source and SHA-256 evidence required")
        with self._lock:
            return self._append_event(
                "HEALTH", provider,
                {"healthy": bool(healthy), "source_id": source_id, "evidence_hash": evidence_hash},
                occurred_at or utcnow(),
            )

    def set_policy_allowed(
        self,
        provider: str,
        allowed: bool,
        *,
        policy_version: str,
        evidence_hash: str,
        occurred_at: str | None = None,
    ) -> str:
        if not policy_version or not _valid_hash(evidence_hash):
            raise ValueError("policy version and SHA-256 evidence required")
        with self._lock:
            return self._append_event(
                "POLICY", provider,
                {"allowed": bool(allowed), "policy_version": policy_version, "evidence_hash": evidence_hash},
                occurred_at or utcnow(),
            )

    def provider_state(self, name: str) -> ProviderState:
        with self._lock:
            if name not in self._runtime:
                raise FrontierSafetyError("unknown provider")
            return ProviderState.from_normalized(self._runtime[name])

    def route(
        self,
        now: str,
        min_quality: float,
        max_latency_ms: float | None = None,
        max_cost_units: float | None = None,
        *,
        capability: str | None = None,
        jurisdiction: str | None = None,
    ) -> dict[str, Any]:
        when = parse_time(now)
        if not 0.0 <= float(min_quality) <= 1.0:
            raise ValueError("min_quality must be in [0,1]")
        candidates: list[tuple[float, str, ProviderState, str]] = []
        rejection_counts: dict[str, int] = {}
        with self._lock:
            for name, raw in self._runtime.items():
                state = ProviderState.from_normalized(raw)
                reason: str | None = None
                degradation = "NORMAL"
                if not state.healthy:
                    reason = "unhealthy"
                elif not state.policy_allowed:
                    reason = "policy_denied"
                elif capability and state.capabilities and capability not in state.capabilities:
                    reason = "capability_mismatch"
                elif jurisdiction and state.jurisdictions and jurisdiction not in state.jurisdictions:
                    reason = "jurisdiction_mismatch"
                elif state.quality < min_quality:
                    reason = "quality_below_minimum"
                elif max_latency_ms is not None and state.latency_ms > max_latency_ms:
                    reason = "latency_above_maximum"
                elif max_cost_units is not None and state.cost_units > max_cost_units:
                    reason = "cost_above_maximum"
                elif state.circuit_open_until:
                    until = parse_time(state.circuit_open_until)
                    if when < until:
                        reason = "circuit_open"
                    else:
                        degradation = "HALF_OPEN"
                if reason:
                    rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
                    continue
                score = 0.45 * state.quality + 0.25 * state.calibration + 0.30 * state.reliability
                score -= 0.00005 * state.latency_ms + 0.02 * state.cost_units + 0.03 * state.consecutive_failures
                if degradation == "HALF_OPEN":
                    score -= self.policy.half_open_penalty
                candidates.append((score, name, state, degradation))
        if not candidates:
            raise Abstained("no healthy policy-allowed provider satisfies constraints")
        candidates.sort(key=lambda x: (-x[0], x[1]))
        selected = candidates[0]
        fallbacks = [row[2] for row in candidates[1:1 + self.policy.max_fallbacks]]
        return {
            "provider": selected[2],
            "selection_score": selected[0],
            "degradation_state": selected[3],
            "fallbacks": fallbacks,
            "candidate_scores": [(name, score) for score, name, _, _ in candidates],
            "rejection_counts": rejection_counts,
            "policy_version": self.policy.version,
            "selection_sha256": sha256({
                "now": now,
                "selected": selected[1],
                "scores": [(name, score) for score, name, _, _ in candidates],
                "capability": capability,
                "jurisdiction": jurisdiction,
                "policy": self.policy.fingerprint,
            }),
        }

    def history(self, provider: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(e) for e in self._events if provider is None or e.get("provider") == provider]

    def verify(self) -> bool:
        with self._lock:
            previous = None
            seen_outcomes: set[str] = set()
            for i, event in enumerate(self._events):
                body = dict(event)
                actual = body.pop("event_sha256", None)
                if body.get("sequence") != i or body.get("previous_sha256") != previous:
                    raise FrontierSafetyError("routing event sequence integrity failure")
                if body.get("event_type") not in EVENT_TYPES or body.get("provider") not in self._base:
                    raise FrontierSafetyError("invalid routing event reference")
                parse_time(str(body.get("occurred_at")))
                if sha256(body) != actual:
                    raise FrontierSafetyError("routing event integrity failure")
                if body["event_type"] == "OUTCOME":
                    outcome_id = str(body["payload"].get("outcome_id"))
                    if not outcome_id or outcome_id in seen_outcomes:
                        raise FrontierSafetyError("duplicate/missing routing outcome id")
                    seen_outcomes.add(outcome_id)
                previous = actual
            return True

    @property
    def fingerprint(self) -> str:
        with self._lock:
            self.verify()
            return sha256({
                "policy": self.policy.fingerprint,
                "providers": sorted((p.name, p.fingerprint) for p in self._base.values()),
                "events": [e["event_sha256"] for e in self._events],
            })
