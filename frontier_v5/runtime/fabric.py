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
import hmac
import json
import re
import unicodedata
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


# Capability/action names are matched on canonical namespace segments so that
# case, Unicode-compatibility, zero-width and separator variants of a protected
# namespace ("Payment.send", "payments:send", "deploy.Production",
# "money-transfer/send", "ｓｅｃｒｅｔ.read") cannot slip past an exact prefix test.
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_NON_SEGMENT = re.compile(r"[^0-9a-z]+")
_CANONICAL_ACTION = re.compile(r"[0-9a-z._:/\-]*")


def _nfkc_casefold(text: str) -> str:
    return unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", text).casefold())


def normalize_capability_name(name: str | None) -> tuple[str, ...]:
    """Return the canonical namespace segments of a capability/action name.

    NFKC-normalizes, drops Unicode format characters (zero-width joiners etc.),
    splits camelCase boundaries, casefolds, and treats every non-alphanumeric
    character (including ``. _ - : /``) as a segment separator.
    """
    if name is None:
        return ()
    if not isinstance(name, str):
        raise TypeError("capability name must be a string")
    text = unicodedata.normalize("NFKC", name)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")
    text = _CAMEL_BOUNDARY.sub(".", text)
    return tuple(seg for seg in _NON_SEGMENT.split(_nfkc_casefold(text)) if seg)


def is_canonical_capability_name(name: str | None) -> bool:
    """True when the name is plain ASCII letters/digits and ``. _ - : /`` separators
    after NFKC/casefold, i.e. carries no format characters or look-alike letters."""
    if name is None:
        return True
    if not isinstance(name, str):
        return False
    if any(unicodedata.category(ch) == "Cf" for ch in name):
        return False
    return _CANONICAL_ACTION.fullmatch(_nfkc_casefold(name)) is not None


def _singular(segment: str) -> str:
    if len(segment) > 4 and segment.endswith("ies"):
        return segment[:-3] + "y"
    if len(segment) > 3 and segment.endswith("s") and not segment.endswith("ss"):
        return segment[:-1]
    return segment


def _namespace_patterns(names: Iterable[str]) -> tuple[tuple[str, ...], ...]:
    out = []
    for name in names:
        segs = tuple(_singular(s) for s in normalize_capability_name(name))
        if segs and segs not in out:
            out.append(segs)
    return tuple(out)


def _matches_namespace(name: str | None, patterns: Sequence[tuple[str, ...]]) -> bool:
    """True when any contiguous run of segments equals a protected namespace, or a
    single segment equals the namespace with its separators removed."""
    segs = tuple(_singular(s) for s in normalize_capability_name(name))
    if not segs:
        return False
    segment_set = set(segs)
    for pattern in patterns:
        k = len(pattern)
        if any(segs[i:i + k] == pattern for i in range(len(segs) - k + 1)):
            return True
        if k > 1 and _singular("".join(pattern)) in segment_set:
            return True
    return False


# Side-effecting action namespaces: money movement/trading, deployment,
# secrets/credentials, deletion/destruction, external sends and authority
# overrides. Matched with the same canonical segment rules as above.
SIDE_EFFECT_ACTION_NAMESPACES = (
    "payment", "pay", "payout", "transfer", "wire", "remit", "trade", "buy", "sell",
    "refund", "withdraw", "withdrawal", "charge", "purchase",
    "deploy", "deployment",
    "secret", "credential", "password", "passphrase", "api_key", "private_key", "access_key",
    "delete", "destroy", "remove", "drop", "purge", "wipe", "erase", "truncate", "shred",
    "send", "email", "mail", "sms", "publish", "post", "upload", "share", "notify",
    "broadcast", "webhook", "exfiltrate",
    "policy.override", "authorization.override",
)
_SIDE_EFFECT_PATTERNS = _namespace_patterns(SIDE_EFFECT_ACTION_NAMESPACES)


def is_side_effecting_action(name: str | None) -> bool:
    """Conservative name-based classifier for side-effecting capabilities/actions."""
    return _matches_namespace(name, _SIDE_EFFECT_PATTERNS) or _matches_namespace(
        name, InstructionProvenanceFirewall.blocked_namespaces()
    )


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

    Requested actions are compared on canonical namespace segments (see
    ``normalize_capability_name``), so case, separator (``. _ - : /``), plural,
    camelCase, Unicode-compatibility and zero-width variants of a blocked
    namespace are matched wherever the namespace occurs in the name. Untrusted
    content is additionally denied every side-effecting action
    (``is_side_effecting_action``) and every action name that is not a
    canonical ASCII identifier.
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
    def blocked_namespaces(cls) -> tuple[tuple[str, ...], ...]:
        return _namespace_patterns(cls.BLOCKED_ACTION_PREFIXES)

    @classmethod
    def is_blocked_action(cls, action: str | None) -> bool:
        return _matches_namespace(action, cls.blocked_namespaces())

    @classmethod
    def assess(cls, env: InstructionEnvelope) -> dict[str, Any]:
        action = env.requested_action
        untrusted = env.authority in {Authority.RETRIEVED_CONTENT, Authority.MODEL_OUTPUT}
        if action is not None and not isinstance(action, str):
            return {"allowed": False, "reason": "requested_action must be a string"}
        blocked = cls.is_blocked_action(action)
        if untrusted and (
            env.consequential
            or blocked
            or is_side_effecting_action(action)
            or not is_canonical_capability_name(action)
        ):
            return {"allowed": False, "reason": "untrusted content cannot authorize consequential action"}
        if blocked and AUTHORITY_RANK[env.authority] < AUTHORITY_RANK[Authority.USER]:
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


_MIN_HMAC_KEY_BYTES = 16


def _coerce_hmac_key(key: bytes | bytearray | str | None) -> bytes | None:
    """Validate an optional HMAC key; ``str`` keys are UTF-8 encoded."""
    if key is None:
        return None
    if isinstance(key, str):
        key = key.encode("utf-8")
    if not isinstance(key, (bytes, bytearray)):
        raise TypeError("HMAC key must be bytes or str")
    if len(key) < _MIN_HMAC_KEY_BYTES:
        raise ValueError(f"HMAC key must be at least {_MIN_HMAC_KEY_BYTES} bytes")
    return bytes(key)


def _digest_eq(a: str, b: str) -> bool:
    """Constant-time comparison that tolerates arbitrary (attacker-supplied) text."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _hmac_sha256(key: bytes, domain: str, value: Any) -> str:
    """HMAC-SHA256 over a domain tag plus canonical JSON (domain-separated per use)."""
    message = domain.encode("utf-8") + b"\n" + json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


class ProofLedger:
    """Proof envelopes with a reproducibility fingerprint and optional HMAC seal.

    ``reproducibility_fingerprint_sha256`` covers only the deterministic proof
    content: every field except the metadata fields in ``METADATA_FIELDS``
    (``generated_at``, the fingerprint itself and ``proof_hmac_sha256``). Sealing
    identical content therefore always yields the same fingerprint.

    Without a key the fingerprint only detects accidental corruption: anyone
    who can edit an envelope can recompute it. With ``key``, ``seal`` adds
    ``proof_hmac_sha256`` over the whole envelope (content, ``generated_at`` and
    fingerprint) and ``verify_fingerprint(..., key=...)`` rejects edited,
    re-fingerprinted or forged envelopes. ``expected_fingerprint`` pins an
    envelope to an anchor stored elsewhere, which detects substitution even
    without a key.
    """

    REQUIRED = ("question", "evidence", "assumptions", "method", "result")
    METADATA_FIELDS = ("generated_at", "reproducibility_fingerprint_sha256", "proof_hmac_sha256")
    _HMAC_DOMAIN = "musitu-axiom-proof-envelope-v1"

    @classmethod
    def content_fingerprint(cls, payload: Mapping[str, Any]) -> str:
        body = {k: v for k, v in payload.items() if k not in cls.METADATA_FIELDS}
        canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()

    @classmethod
    def seal(cls, payload: Mapping[str, Any], key: bytes | str | None = None) -> dict[str, Any]:
        missing = [k for k in cls.REQUIRED if k not in payload]
        if missing:
            raise ValueError("missing proof fields: " + ",".join(missing))
        hmac_key = _coerce_hmac_key(key)
        out = {k: v for k, v in payload.items()
               if k not in ("reproducibility_fingerprint_sha256", "proof_hmac_sha256")}
        out.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
        out["reproducibility_fingerprint_sha256"] = cls.content_fingerprint(out)
        if hmac_key is not None:
            out["proof_hmac_sha256"] = _hmac_sha256(hmac_key, cls._HMAC_DOMAIN, out)
        return out

    @classmethod
    def verify_fingerprint(cls, payload: Mapping[str, Any], key: bytes | str | None = None, *,
                           expected_fingerprint: str | None = None) -> bool:
        hmac_key = _coerce_hmac_key(key)
        fingerprint = payload.get("reproducibility_fingerprint_sha256")
        if not isinstance(fingerprint, str):
            return False
        if not _digest_eq(cls.content_fingerprint(payload), fingerprint):
            return False
        if expected_fingerprint is not None and not _digest_eq(str(expected_fingerprint), fingerprint):
            return False
        if hmac_key is not None:
            mac = payload.get("proof_hmac_sha256")
            signed = {k: v for k, v in payload.items() if k != "proof_hmac_sha256"}
            if not isinstance(mac, str) or not _digest_eq(_hmac_sha256(hmac_key, cls._HMAC_DOMAIN, signed), mac):
                return False
        return True


@dataclass
class EvalResult:
    suite: str
    status: str
    metrics: dict[str, float] = field(default_factory=dict)
    evidence: dict[str, Any] = field(default_factory=dict)


class PromotionPolicy:
    """Fail-closed promotion decision over recorded evaluation results.

    There is no supersede mechanism for ``EvalResult``: every result recorded
    for a required suite counts, so any non-PASS result fails that suite even
    when a later PASS was also recorded. Re-run and submit a fresh result set.
    """

    REQUIRED_SUITES = frozenset({"functional", "security", "policy", "regression", "unseen_eval", "provenance"})

    @classmethod
    def decide(cls, results: Sequence[EvalResult]) -> dict[str, Any]:
        statuses: dict[str, list[str]] = {}
        for r in results:
            statuses.setdefault(r.suite, []).append(r.status)
        missing = sorted(cls.REQUIRED_SUITES - statuses.keys())
        failed = sorted(
            s for s in cls.REQUIRED_SUITES
            if s in statuses and any(status != "PASS" for status in statuses[s])
        )
        status = "PASS" if not missing and not failed else "FAIL"
        return {"gate": "MUSITU_AXIOM_FRONTIER_PROMOTION", "status": status, "missing": missing, "failed": failed}


__all__ = [
    "ActionPolicy", "Authority", "AuthorizationError", "Capability", "CapabilityRegistry",
    "EvalResult", "EvidenceClass", "EvidenceRecord", "FrontierError", "GovernanceEngine",
    "InstructionEnvelope", "InstructionProvenanceFirewall", "PolicyContext", "PromotionPolicy",
    "ProofLedger", "RouteRequest", "SIDE_EFFECT_ACTION_NAMESPACES", "TemporalEvidenceGraph",
    "TemporalFact", "is_canonical_capability_name", "is_side_effecting_action",
    "normalize_capability_name",
]
