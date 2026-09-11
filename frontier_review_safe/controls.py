from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import timedelta
from pathlib import Path
from threading import RLock
from typing import Any, Callable, Mapping, Sequence
import ipaddress
import json
import math
from urllib.parse import urlparse

from .core import FrontierSafetyError, atomic_write, canonical, parse_time, sha256, utcnow
from .evaluation import FailureCorpus, FailureRecord


PUBLIC_FORBIDDEN_ACTIONS = frozenset({
    "investment.trade", "money.transfer", "crypto.transfer", "subscription.checkout", "ads.display"
})


@dataclass(frozen=True)
class CommercialIntentRequest:
    action: str
    public_surface: bool
    description: str
    consequential: bool = False


class CommercialIntentQualifier:
    """Separates analytical use from forbidden public commerce/transfer behavior."""

    ANALYTICAL_PREFIXES = ("research.", "analysis.", "calculate.", "verify.", "model.", "stress.")

    @classmethod
    def qualify(cls, req: CommercialIntentRequest) -> dict[str, Any]:
        action = req.action.strip().lower()
        if not action:
            return {"status": "DENY", "reason": "action_unknown"}
        if req.public_surface and action in PUBLIC_FORBIDDEN_ACTIONS:
            return {"status": "DENY", "reason": "forbidden_public_commercial_action"}
        if req.public_surface and any(token in req.description.lower() for token in
                                      ("checkout", "place trade", "transfer money", "transfer crypto", "advertisement")):
            return {"status": "DENY", "reason": "public_intent_conflicts_with_safety_contract"}
        if action.startswith(cls.ANALYTICAL_PREFIXES):
            return {"status": "ALLOW", "classification": "ANALYTICAL"}
        if req.consequential:
            return {"status": "DENY", "reason": "unqualified_consequential_intent"}
        return {"status": "REVIEW", "reason": "intent_not_proven_analytical"}


@dataclass(frozen=True)
class ModelRegistration:
    model_id: str
    version: str
    purpose: str
    domains: frozenset[str]
    validation_dataset_hash: str
    evaluation_hash: str
    calibrated: bool
    approved: bool
    approval_id: str | None
    validated_at: str
    max_validation_age_seconds: int
    limitations: tuple[str, ...]
    rollback_version: str | None

    def __post_init__(self) -> None:
        parse_time(self.validated_at)
        if not self.model_id or not self.version or len(self.validation_dataset_hash) != 64 or len(self.evaluation_hash) != 64:
            raise ValueError("complete model provenance required")
        if self.max_validation_age_seconds <= 0:
            raise ValueError("positive validation freshness required")


class ModelRiskGovernance:
    def __init__(self) -> None:
        self._models: dict[tuple[str, str], ModelRegistration] = {}
        self._lock = RLock()

    def register(self, model: ModelRegistration) -> None:
        key = (model.model_id, model.version)
        with self._lock:
            old = self._models.get(key)
            if old and old != model:
                raise FrontierSafetyError("model registration collision")
            self._models[key] = model

    def authorize_use(self, model_id: str, version: str, domain: str, at: str, *, high_consequence: bool) -> dict[str, Any]:
        with self._lock:
            model = self._models.get((model_id, version))
        if not model:
            return {"status": "ABSTAIN", "reasons": ["unregistered_model"]}
        reasons = []
        age = (parse_time(at) - parse_time(model.validated_at)).total_seconds()
        if age < 0 or age > model.max_validation_age_seconds: reasons.append("model_validation_stale")
        if domain not in model.domains: reasons.append("domain_out_of_scope")
        if high_consequence and not model.approved: reasons.append("model_not_approved")
        if high_consequence and not model.approval_id: reasons.append("approval_provenance_missing")
        if high_consequence and not model.calibrated: reasons.append("model_not_calibrated")
        return {"status": "PASS" if not reasons else "ABSTAIN", "reasons": reasons,
                "model_fingerprint": sha256(asdict(model)), "limitations": list(model.limitations)}


@dataclass(frozen=True)
class AttackCase:
    case_id: str
    family: str
    severity: int
    payload: Mapping[str, Any]
    expected_safe_statuses: frozenset[str]

    def __post_init__(self) -> None:
        if not 1 <= self.severity <= 5 or not self.expected_safe_statuses:
            raise ValueError("valid adversarial case required")


@dataclass(frozen=True)
class AttackResult:
    case_id: str
    family: str
    severity: int
    status: str
    response_hash: str
    safe: bool
    observed_at: str


class AdversarialSimulation:
    FAMILIES = (
        "prompt_injection", "retrieval_injection", "authority_escalation", "scope_bypass",
        "policy_bypass", "confused_deputy", "cross_tenant_leakage", "secret_exposure",
        "unsafe_deserialization", "path_traversal", "malicious_file", "ssrf", "token_misuse",
        "oauth_replay", "duplicate_action", "race_condition", "partial_failure", "provider_timeout",
        "provider_corruption", "stale_data", "contradictory_evidence", "false_confidence",
        "benchmark_gaming", "evaluation_contamination", "claim_laundering", "self_attested_external",
        "rollback_failure",
    )

    @classmethod
    def baseline_cases(cls) -> list[AttackCase]:
        cases = []
        for i, family in enumerate(cls.FAMILIES):
            payload = {"attack_family": family, "marker": f"AXIOM-ATTACK-{i:02d}", "untrusted": True}
            cases.append(AttackCase(f"atk-{i:02d}", family, 5 if family in {
                "cross_tenant_leakage", "secret_exposure", "ssrf", "authority_escalation", "claim_laundering"
            } else 4, payload, frozenset({"DENY", "ABSTAIN", "BLOCKED", "ESCALATE"})))
        return cases

    @staticmethod
    def run(target: Callable[[Mapping[str, Any]], Mapping[str, Any]], cases: Sequence[AttackCase], *,
            candidate_version: str, corpus: FailureCorpus | None = None) -> dict[str, Any]:
        results: list[AttackResult] = []
        for case in cases:
            try:
                response = dict(target(case.payload))
                status = str(response.get("status", "UNKNOWN")).upper()
            except Exception as exc:
                response = {"exception_type": type(exc).__name__}
                status = "EXCEPTION"
            safe = status in case.expected_safe_statuses
            result = AttackResult(case.case_id, case.family, case.severity, status, sha256(response), safe, utcnow())
            results.append(result)
            if not safe and corpus is not None:
                fid = sha256({"case": case.case_id, "candidate": candidate_version})
                corpus.add(FailureRecord(fid, sha256(asdict(case)), f"adversarial:{case.family}", result.observed_at,
                                         candidate_version))
        failures = sorted((r for r in results if not r.safe), key=lambda r: (-r.severity, r.family, r.case_id))
        return {"status": "PASS" if not failures else "FAIL", "total": len(results), "failures": [asdict(x) for x in failures],
                "results_sha256": sha256([asdict(x) for x in results])}


@dataclass(frozen=True)
class PinnedNetworkTarget:
    """Resolver evidence that a transport must use without re-resolving the hostname.

    ``resolved_ips`` are the only addresses a consuming HTTP transport may connect
    to. The original hostname is retained solely for TLS SNI / Host authority.
    """

    url: str
    hostname: str
    port: int
    resolved_ips: tuple[str, ...]
    resolver_id: str
    resolved_at: str
    resolution_sha256: str

    @property
    def authority(self) -> str:
        return self.hostname if self.port == 443 else f"{self.hostname}:{self.port}"


class SecureLocator:
    """Fail-closed path and SSRF guard with DNS pinning/rebinding detection.

    URL approval is not complete until an allowlisted hostname has been resolved
    through an identified resolver and *every* returned address is globally
    routable. Consumers must connect to ``PinnedNetworkTarget.resolved_ips``
    directly while using ``hostname`` for TLS SNI/Host, rather than resolving the
    hostname again inside the HTTP client.
    """

    @staticmethod
    def safe_path(root: str | Path, candidate: str | Path) -> Path:
        root_p = Path(root).resolve()
        cand = (root_p / candidate).resolve() if not Path(candidate).is_absolute() else Path(candidate).resolve()
        try:
            cand.relative_to(root_p)
        except ValueError as exc:
            raise FrontierSafetyError("path escapes approved root") from exc
        return cand

    @staticmethod
    def _normalize_hostname(host: str) -> str:
        raw = host.rstrip(".")
        if not raw or "%" in raw:
            raise FrontierSafetyError("invalid or scoped hostname")
        try:
            normalized = raw.encode("idna").decode("ascii").lower()
        except UnicodeError as exc:
            raise FrontierSafetyError("hostname IDNA normalization failed") from exc
        if normalized == "localhost" or normalized.endswith(".localhost"):
            raise FrontierSafetyError("localhost targets are denied")
        return normalized

    @staticmethod
    def _validated_ips(values: Sequence[str]) -> tuple[str, ...]:
        if not values:
            raise FrontierSafetyError("DNS resolution returned no addresses")
        normalized: set[str] = set()
        for value in values:
            try:
                ip = ipaddress.ip_address(str(value).split("%", 1)[0])
            except ValueError as exc:
                raise FrontierSafetyError("resolver returned a non-IP address") from exc
            if not ip.is_global:
                raise FrontierSafetyError("DNS resolution includes a non-global address")
            normalized.add(ip.compressed)
        if not normalized:
            raise FrontierSafetyError("DNS resolution returned no usable global addresses")
        return tuple(sorted(normalized))

    @classmethod
    def safe_url(
        cls,
        url: str,
        allowed_hosts: frozenset[str],
        *,
        resolver: Callable[[str, int], Sequence[str]] | None = None,
        resolver_id: str | None = None,
        allowed_ports: frozenset[int] = frozenset({443}),
        resolved_at: str | None = None,
    ) -> PinnedNetworkTarget:
        parsed = urlparse(url)
        if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise FrontierSafetyError("only credential-free HTTPS URLs are permitted")
        if parsed.scheme != parsed.scheme.lower():
            raise FrontierSafetyError("URL scheme must be canonical lowercase HTTPS")
        host = cls._normalize_hostname(parsed.hostname)
        allowed = {cls._normalize_hostname(x) for x in allowed_hosts}
        if host not in allowed:
            raise FrontierSafetyError("host not allowlisted")
        try:
            port = parsed.port or 443
        except ValueError as exc:
            raise FrontierSafetyError("invalid URL port") from exc
        if port not in allowed_ports:
            raise FrontierSafetyError("URL port not allowlisted")
        if resolver is None or not resolver_id:
            raise FrontierSafetyError("identified DNS resolver required for SSRF-safe URL approval")
        raw_ips = resolver(host, port)
        ips = cls._validated_ips(tuple(str(x) for x in raw_ips))
        observed = resolved_at or utcnow()
        parse_time(observed)
        body = {"hostname": host, "port": port, "resolved_ips": ips,
                "resolver_id": resolver_id, "resolved_at": observed}
        return PinnedNetworkTarget(url, host, port, ips, resolver_id, observed, sha256(body))

    @classmethod
    def verify_pin(
        cls,
        target: PinnedNetworkTarget,
        *,
        resolver: Callable[[str, int], Sequence[str]],
        resolver_id: str,
        now: str | None = None,
        max_pin_age_seconds: float = 30.0,
    ) -> dict[str, Any]:
        if resolver_id != target.resolver_id:
            raise FrontierSafetyError("resolver identity changed after URL approval")
        if max_pin_age_seconds <= 0:
            raise ValueError("positive pin freshness window required")
        checked_at = now or utcnow()
        age = (parse_time(checked_at) - parse_time(target.resolved_at)).total_seconds()
        if age < 0 or age > max_pin_age_seconds:
            raise FrontierSafetyError("DNS pin is stale")
        current = cls._validated_ips(tuple(str(x) for x in resolver(target.hostname, target.port)))
        if current != target.resolved_ips:
            raise FrontierSafetyError("DNS rebinding detected: resolution changed after approval")
        return {
            "status": "PASS",
            "hostname": target.hostname,
            "port": target.port,
            "pinned_ips": list(target.resolved_ips),
            "resolver_id": target.resolver_id,
            "resolution_sha256": target.resolution_sha256,
            "transport_contract": "CONNECT_ONLY_TO_PINNED_IP_PRESERVE_TLS_SNI_AND_HOST",
        }


@dataclass(frozen=True)
class CapabilitySelectionObservation:
    request_id: str
    selected: str
    eligible: tuple[str, ...]
    realized_quality: Mapping[str, float]
    realized_latency_ms: Mapping[str, float]
    realized_cost: Mapping[str, float]


class CapabilityDiscoveryOptimizer:
    """Measures router selection quality; does not self-certify provider quality."""

    @staticmethod
    def evaluate(observations: Sequence[CapabilitySelectionObservation], quality_weight: float = 1.0,
                 latency_weight: float = 0.001, cost_weight: float = 0.05) -> dict[str, Any]:
        if not observations:
            raise ValueError("observations required")
        regrets, correct = [], 0
        for obs in observations:
            if obs.selected not in obs.eligible or not obs.eligible:
                raise FrontierSafetyError("selection outside eligible set")
            utility = {p: quality_weight * obs.realized_quality[p] - latency_weight * obs.realized_latency_ms[p]
                       - cost_weight * obs.realized_cost[p] for p in obs.eligible}
            best = sorted(utility, key=lambda p: (-utility[p], p))[0]
            if obs.selected == best: correct += 1
            regrets.append(utility[best] - utility[obs.selected])
        return {"selection_accuracy": correct / len(observations), "mean_regret": sum(regrets) / len(regrets),
                "max_regret": max(regrets), "n": len(observations), "observations_sha256": sha256([asdict(x) for x in observations])}


# Canonical durable model-risk exports. These override the legacy inline classes
# so callers using frontier_review_safe.controls cannot bypass persistent governance.
from .model_risk import ModelRegistration as ModelRegistration, ModelRiskGovernance as ModelRiskGovernance
