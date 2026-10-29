#!/usr/bin/env python3
"""Core MUSITU Axiom Frontier Fabric primitives.

Development-only. This module does not grant external tools, permissions, or
production authority. It provides deterministic contracts for evidence,
temporal knowledge, capability routing, instruction provenance, governance,
and proof fingerprints so higher-level agents can be tested fail-closed.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
import hashlib
import json
from typing import Any, Iterable, Mapping, Sequence


class FrontierError(RuntimeError):
    pass


class AuthorizationError(FrontierError):
    pass


class EvidenceClass(str, Enum):
    USER = "USER"
    RETRIEVED = "RETRIEVED"
    COMPUTED = "COMPUTED"
    ASSUMED = "ASSUMED"
    INFERRED = "INFERRED"
    UNKNOWN = "UNKNOWN"


class Authority(str, Enum):
    SYSTEM = "system"
    DEVELOPER = "developer"
    USER = "user"
    TRUSTED_TOOL = "trusted_tool"
    RETRIEVED_CONTENT = "retrieved_content"
    MODEL_OUTPUT = "model_output"


AUTHORITY_RANK = {
    Authority.SYSTEM: 60,
    Authority.DEVELOPER: 50,
    Authority.USER: 40,
    Authority.TRUSTED_TOOL: 30,
    Authority.RETRIEVED_CONTENT: 10,
    Authority.MODEL_OUTPUT: 5,
}


@dataclass(frozen=True)
class EvidenceRecord:
    evidence_class: EvidenceClass
    value: Any
    source: str
    observed_at: str
    confidence: float = 1.0
    source_hash: str | None = None

    def __post_init__(self) -> None:
        if not self.source:
            raise ValueError("source is required")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError("confidence must be in [0,1]")

    @staticmethod
    def fingerprint(value: Any) -> str:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(payload.encode()).hexdigest()


@dataclass(frozen=True)
class TemporalFact:
    key: str
    value: Any
    valid_from: str
    valid_to: str | None
    evidence: EvidenceRecord
    supersedes: str | None = None

    def contains(self, at: str) -> bool:
        return self.valid_from <= at and (self.valid_to is None or at < self.valid_to)

    @property
    def fact_id(self) -> str:
        body = {
            "key": self.key,
            "value": self.value,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
            "source": self.evidence.source,
        }
        return EvidenceRecord.fingerprint(body)


class TemporalEvidenceGraph:
    def __init__(self) -> None:
        self._facts: dict[str, list[TemporalFact]] = {}

    def add(self, fact: TemporalFact) -> str:
        if fact.valid_to is not None and fact.valid_to <= fact.valid_from:
            raise ValueError("valid_to must be later than valid_from")
        bucket = self._facts.setdefault(fact.key, [])
        if fact.supersedes and all(x.fact_id != fact.supersedes for x in bucket):
            raise ValueError("superseded fact does not exist")
        bucket.append(fact)
        bucket.sort(key=lambda x: x.valid_from)
        return fact.fact_id

    def as_of(self, key: str, at: str) -> list[TemporalFact]:
        return [f for f in self._facts.get(key, []) if f.contains(at)]

    def current(self, key: str) -> list[TemporalFact]:
        now = datetime.now(timezone.utc).isoformat()
        return self.as_of(key, now)

    def conflicts(self, key: str, at: str) -> list[TemporalFact]:
        active = self.as_of(key, at)
        if len({json.dumps(f.value, sort_keys=True, default=str) for f in active}) <= 1:
            return []
        return active


@dataclass(frozen=True)
class Capability:
    name: str
    domains: frozenset[str]
    modalities: frozenset[str]
    required_scopes: frozenset[str] = frozenset()
    quality: float = 0.5
    latency_ms: int = 1000
    cost_units: float = 1.0
    verified: bool = False
    destructive: bool = False

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("capability name required")
        if not (0 <= self.quality <= 1):
            raise ValueError("quality must be in [0,1]")
        if self.latency_ms < 0 or self.cost_units < 0:
            raise ValueError("latency/cost cannot be negative")


@dataclass(frozen=True)
class RouteRequest:
    domain: str
    modality: str
    available_scopes: frozenset[str]
    min_quality: float = 0.0
    max_latency_ms: int | None = None
    max_cost_units: float | None = None
    require_verified: bool = True
    allow_destructive: bool = False


class CapabilityRegistry:
    def __init__(self) -> None:
        self._caps: dict[str, Capability] = {}

    def register(self, cap: Capability) -> None:
        if cap.name in self._caps:
            raise ValueError(f"duplicate capability: {cap.name}")
        self._caps[cap.name] = cap

    def get(self, name: str) -> Capability:
        try:
            return self._caps[name]
        except KeyError as exc:
            raise FrontierError(f"unknown capability: {name}") from exc

    def route(self, req: RouteRequest) -> Capability:
        candidates = []
        for cap in self._caps.values():
            if req.domain not in cap.domains or req.modality not in cap.modalities:
                continue
            if not cap.required_scopes.issubset(req.available_scopes):
                continue
            if req.require_verified and not cap.verified:
                continue
            if cap.destructive and not req.allow_destructive:
                continue
            if cap.quality < req.min_quality:
                continue
            if req.max_latency_ms is not None and cap.latency_ms > req.max_latency_ms:
                continue
            if req.max_cost_units is not None and cap.cost_units > req.max_cost_units:
                continue
            candidates.append(cap)
        if not candidates:
            raise FrontierError("no authorized verified capability satisfies the route request")
        # quality first; then lower latency and lower cost as deterministic tie-breakers
        return sorted(candidates, key=lambda c: (-c.quality, c.latency_ms, c.cost_units, c.name))[0]


@dataclass(frozen=True)
class InstructionEnvelope:
    text: str
    authority: Authority
    source: str
    requested_action: str | None = None
    consequential: bool = False


class InstructionProvenanceFirewall:
    """Conservative authority gate.

    Retrieved/model content can inform analysis but cannot independently
    authorize consequential actions or credential/policy changes.
    """

    BLOCKED_ACTION_PREFIXES = (
        "credential.",
        "secret.",
        "policy.override",
        "authorization.override",
        "payment.",
        "trade.",
        "money_transfer.",
        "crypto_transfer.",
        "deploy.production",
    )

    @classmethod
    def assess(cls, env: InstructionEnvelope) -> dict[str, Any]:
        action = env.requested_action or ""
        untrusted = env.authority in {Authority.RETRIEVED_CONTENT, Authority.MODEL_OUTPUT}
        blocked_prefix = any(action.startswith(p) for p in cls.BLOCKED_ACTION_PREFIXES)
        if untrusted and (env.consequential or blocked_prefix):
            return {"allowed": False, "reason": "untrusted content cannot authorize consequential action"}
        if blocked_prefix and AUTHORITY_RANK[env.authority] < AUTHORITY_RANK[Authority.USER]:
            return {"allowed": False, "reason": "insufficient authority for protected action"}
        return {"allowed": True, "reason": "treated within declared authority"}

    @staticmethod
    def resolve_conflict(a: InstructionEnvelope, b: InstructionEnvelope) -> InstructionEnvelope:
        ra, rb = AUTHORITY_RANK[a.authority], AUTHORITY_RANK[b.authority]
        if ra == rb and a.text != b.text:
            raise FrontierError("same-authority instruction conflict requires explicit resolution")
        return a if ra > rb else b


@dataclass(frozen=True)
class PolicyContext:
    identity: str | None
    role: str | None
    jurisdiction: str | None
    granted_scopes: frozenset[str]
    approvals: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ActionPolicy:
    action: str
    required_scopes: frozenset[str]
    required_roles: frozenset[str] = frozenset()
    required_approvals: frozenset[str] = frozenset()
    allowed_jurisdictions: frozenset[str] | None = None


class GovernanceEngine:
    @staticmethod
    def authorize(ctx: PolicyContext, policy: ActionPolicy) -> dict[str, Any]:
        if not ctx.identity or not ctx.role:
            raise AuthorizationError("authenticated identity and role required")
        if not policy.required_scopes.issubset(ctx.granted_scopes):
            raise AuthorizationError("required scope missing")
        if policy.required_roles and ctx.role not in policy.required_roles:
            raise AuthorizationError("role not authorized")
        if not policy.required_approvals.issubset(ctx.approvals):
            raise AuthorizationError("required approval missing")
        if policy.allowed_jurisdictions is not None:
            if not ctx.jurisdiction or ctx.jurisdiction not in policy.allowed_jurisdictions:
                raise AuthorizationError("jurisdiction not authorized")
        return {"authorized": True, "action": policy.action, "identity": ctx.identity}


class ProofLedger:
    REQUIRED = ("question", "evidence", "assumptions", "method", "result")

    @classmethod
    def seal(cls, payload: Mapping[str, Any]) -> dict[str, Any]:
        missing = [k for k in cls.REQUIRED if k not in payload]
        if missing:
            raise ValueError("missing proof fields: " + ",".join(missing))
        out = dict(payload)
        out.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
        canonical = json.dumps(out, sort_keys=True, separators=(",", ":"), default=str)
        out["reproducibility_fingerprint_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
        return out

    @staticmethod
    def verify_fingerprint(payload: Mapping[str, Any]) -> bool:
        if "reproducibility_fingerprint_sha256" not in payload:
            return False
        data = dict(payload)
        expected = data.pop("reproducibility_fingerprint_sha256")
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(canonical.encode()).hexdigest() == expected


@dataclass
class EvalResult:
    suite: str
    status: str
    metrics: dict[str, float] = field(default_factory=dict)
    evidence: dict[str, Any] = field(default_factory=dict)


class PromotionPolicy:
    REQUIRED_SUITES = frozenset({"functional", "security", "policy", "regression", "unseen_eval", "provenance"})

    @classmethod
    def decide(cls, results: Sequence[EvalResult]) -> dict[str, Any]:
        by_suite = {r.suite: r for r in results}
        missing = sorted(cls.REQUIRED_SUITES - by_suite.keys())
        failed = sorted(s for s in cls.REQUIRED_SUITES if s in by_suite and by_suite[s].status != "PASS")
        status = "PASS" if not missing and not failed else "FAIL"
        return {"gate": "MUSITU_AXIOM_FRONTIER_PROMOTION", "status": status, "missing": missing, "failed": failed}


__all__ = [
    "ActionPolicy", "Authority", "AuthorizationError", "Capability", "CapabilityRegistry",
    "EvalResult", "EvidenceClass", "EvidenceRecord", "FrontierError", "GovernanceEngine",
    "InstructionEnvelope", "InstructionProvenanceFirewall", "PolicyContext", "PromotionPolicy",
    "ProofLedger", "RouteRequest", "TemporalEvidenceGraph", "TemporalFact",
]
