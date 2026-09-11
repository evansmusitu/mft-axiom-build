from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
import re
import unicodedata

from .core import FrontierSafetyError, sha256

POLICY_VERSION = "musitu.axiom.commercial-intent.v2"

PUBLIC_FORBIDDEN_ACTIONS = frozenset({
    "investment.trade",
    "money.transfer",
    "crypto.transfer",
    "subscription.checkout",
    "ads.display",
})
PUBLIC_FORBIDDEN_EFFECTS = frozenset({
    "investment_trade",
    "order_execution",
    "money_transfer",
    "crypto_transfer",
    "subscription_checkout",
    "payment_execution",
    "ads_display",
})
SAFE_ANALYTICAL_EFFECTS = frozenset({
    "read",
    "compute",
    "research",
    "summarize",
    "verify",
    "model",
    "stress_test",
    "compare",
    "explain",
})
ANALYTICAL_NAMESPACES = frozenset({"research", "analysis", "calculate", "verify", "model", "stress"})
_OPERATIONAL_PATTERNS = (
    re.compile(r"\bplace\s+(?:an?\s+)?(?:investment\s+)?(?:trade|order)\b", re.I),
    re.compile(r"\bexecute\s+(?:an?\s+)?(?:trade|order|payment|transfer)\b", re.I),
    re.compile(r"\btransfer\s+(?:money|funds|cash|crypto|bitcoin|ethereum|tokens?)\b", re.I),
    re.compile(r"\b(?:start|open|complete|process)\s+(?:a\s+)?checkout\b", re.I),
    re.compile(r"\b(?:display|serve|insert)\s+(?:an?\s+)?ads?\b", re.I),
    re.compile(r"\bbuy\s+(?:shares?|stocks?|securities|crypto|bitcoin|ethereum)\b", re.I),
    re.compile(r"\bsell\s+(?:shares?|stocks?|securities|crypto|bitcoin|ethereum)\b", re.I),
)
_ACTION_OPERATIONAL_TOKENS = frozenset({
    "trade", "transfer", "checkout", "payment", "pay", "advertise", "ads", "order", "purchase", "subscribe",
})
_ACTION_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_EFFECT_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")


@dataclass(frozen=True)
class CommercialIntentRequest:
    action: str
    public_surface: bool
    description: str
    consequential: bool = False
    effects: frozenset[str] = frozenset()
    resource_kind: str | None = None
    target: str | None = None

    @property
    def normalized(self) -> dict[str, Any]:
        return {
            "action": _normalize_action(self.action),
            "public_surface": bool(self.public_surface),
            "description": unicodedata.normalize("NFKC", self.description or "").strip(),
            "consequential": bool(self.consequential),
            "effects": sorted(_normalize_effect(x) for x in self.effects),
            "resource_kind": unicodedata.normalize("NFKC", self.resource_kind or "").strip().lower() or None,
            "target": unicodedata.normalize("NFKC", self.target or "").strip() or None,
        }

    @property
    def fingerprint(self) -> str:
        return sha256(self.normalized)


@dataclass(frozen=True)
class CommercialIntentDecision:
    status: str
    classification: str
    reason: str
    policy_version: str
    intent_sha256: str
    matched_rules: tuple[str, ...]
    permitted_effects: tuple[str, ...]
    public_surface: bool

    def __post_init__(self) -> None:
        if self.status not in {"ALLOW", "DENY", "REVIEW"}:
            raise ValueError("invalid commercial-intent decision status")
        if len(self.intent_sha256) != 64:
            raise ValueError("intent_sha256 must be SHA-256")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_action(value: str) -> str:
    action = unicodedata.normalize("NFKC", value or "").strip().lower()
    if not action or not _ACTION_RE.fullmatch(action):
        raise ValueError("action must use canonical lowercase dotted/token syntax")
    return action


def _normalize_effect(value: str) -> str:
    effect = unicodedata.normalize("NFKC", str(value)).strip().lower().replace("-", "_")
    if not effect or not _EFFECT_RE.fullmatch(effect):
        raise ValueError("invalid structured intent effect")
    return effect


class CommercialIntentQualifier:
    """Versioned fail-closed qualification for analysis vs consequential commerce.

    Public analytical calls are bounded to read/compute-style effects. Free text is
    never sufficient to authorize a side effect; it is used only as an additional
    denial signal. Legacy analytical calls with no explicit effects remain supported
    but receive an explicit ``ANALYSIS_ONLY`` effect boundary.
    """

    @staticmethod
    def _decision(
        req: CommercialIntentRequest,
        *,
        status: str,
        classification: str,
        reason: str,
        matched_rules: tuple[str, ...],
        permitted_effects: tuple[str, ...] = (),
    ) -> dict[str, Any]:
        return CommercialIntentDecision(
            status=status,
            classification=classification,
            reason=reason,
            policy_version=POLICY_VERSION,
            intent_sha256=req.fingerprint,
            matched_rules=matched_rules,
            permitted_effects=permitted_effects,
            public_surface=req.public_surface,
        ).as_dict()

    @classmethod
    def qualify(cls, req: CommercialIntentRequest) -> dict[str, Any]:
        try:
            normalized = req.normalized
        except (TypeError, ValueError) as exc:
            # Invalid or obfuscated action/effect syntax can never authorize work.
            return {
                "status": "DENY",
                "classification": "INVALID",
                "reason": "invalid_intent_contract",
                "policy_version": POLICY_VERSION,
                "intent_sha256": sha256({"raw_action": str(req.action), "public_surface": bool(req.public_surface)}),
                "matched_rules": ["canonical_syntax_required"],
                "permitted_effects": [],
                "public_surface": bool(req.public_surface),
                "error_type": type(exc).__name__,
            }

        action = normalized["action"]
        effects = frozenset(normalized["effects"])
        description = normalized["description"]
        namespace = re.split(r"[._-]", action, maxsplit=1)[0]
        action_tokens = frozenset(re.split(r"[._-]", action))
        operational_text = any(pattern.search(description) for pattern in _OPERATIONAL_PATTERNS)
        forbidden_action_token = bool(action_tokens & _ACTION_OPERATIONAL_TOKENS)
        forbidden_effects = sorted(effects & PUBLIC_FORBIDDEN_EFFECTS)
        unknown_effects = sorted(effects - SAFE_ANALYTICAL_EFFECTS - PUBLIC_FORBIDDEN_EFFECTS)

        if req.public_surface and action in PUBLIC_FORBIDDEN_ACTIONS:
            return cls._decision(
                req, status="DENY", classification="FORBIDDEN_PUBLIC_COMMERCE",
                reason="forbidden_public_action", matched_rules=("exact_public_action_deny",),
            )
        if req.public_surface and forbidden_effects:
            return cls._decision(
                req, status="DENY", classification="FORBIDDEN_PUBLIC_COMMERCE",
                reason="forbidden_public_effect", matched_rules=("structured_effect_deny",),
            )
        if req.public_surface and (operational_text or forbidden_action_token):
            return cls._decision(
                req, status="DENY", classification="FORBIDDEN_PUBLIC_COMMERCE",
                reason="public_side_effect_signal_detected",
                matched_rules=("operational_action_or_text_deny",),
            )
        if req.public_surface and unknown_effects:
            return cls._decision(
                req, status="DENY", classification="UNKNOWN_PUBLIC_EFFECT",
                reason="unknown_public_effect_fail_closed",
                matched_rules=("public_effect_allowlist",),
            )

        if namespace in ANALYTICAL_NAMESPACES:
            if effects and not effects.issubset(SAFE_ANALYTICAL_EFFECTS):
                return cls._decision(
                    req, status="REVIEW" if not req.public_surface else "DENY",
                    classification="MIXED_OR_UNKNOWN",
                    reason="analytical_namespace_has_nonanalytical_effect",
                    matched_rules=("analytical_effect_boundary",),
                )
            boundary = tuple(sorted(effects)) if effects else ("analysis_only",)
            return cls._decision(
                req, status="ALLOW", classification="ANALYTICAL",
                reason="bounded_analytical_intent",
                matched_rules=("analytical_namespace_allow", "no_public_side_effect"),
                permitted_effects=boundary,
            )

        if req.public_surface and req.consequential:
            return cls._decision(
                req, status="DENY", classification="UNQUALIFIED_CONSEQUENTIAL",
                reason="unqualified_consequential_public_intent",
                matched_rules=("public_consequential_fail_closed",),
            )
        if req.public_surface:
            return cls._decision(
                req, status="REVIEW", classification="UNCLASSIFIED",
                reason="public_intent_not_proven_analytical",
                matched_rules=("public_default_review",),
            )
        if forbidden_effects or operational_text or forbidden_action_token:
            return cls._decision(
                req, status="REVIEW", classification="PRIVATE_CONSEQUENTIAL",
                reason="private_side_effect_requires_separate_authorization",
                matched_rules=("private_consequential_review",),
            )
        return cls._decision(
            req, status="REVIEW", classification="UNCLASSIFIED",
            reason="intent_not_proven_analytical",
            matched_rules=("default_review",),
        )

    @classmethod
    def assert_public_safe(cls, req: CommercialIntentRequest) -> dict[str, Any]:
        decision = cls.qualify(req)
        if req.public_surface and decision["status"] != "ALLOW":
            raise FrontierSafetyError("public commercial intent denied: " + decision["reason"])
        return decision
