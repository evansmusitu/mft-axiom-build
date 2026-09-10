from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence

from .core import AuthorizationDenied, FrontierSafetyError, parse_time, sha256

@dataclass(frozen=True)
class Principal:
    principal_id: str
    tenant_id: str
    roles: frozenset[str]
    scopes: frozenset[str]
    jurisdiction: str | None
    approvals: frozenset[str] = frozenset()
    delegated_by: str | None = None
    delegation_scopes: frozenset[str] = frozenset()


@dataclass(frozen=True)
class AuthorizationRequest:
    action: str
    resource: str
    resource_tenant_id: str
    required_scopes: frozenset[str] = frozenset()
    required_roles: frozenset[str] = frozenset()
    required_approvals: frozenset[str] = frozenset()
    jurisdiction: str | None = None
    consequential: bool = False
    context: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PolicyRule:
    rule_id: str
    version: str
    effect: str  # ALLOW or DENY
    actions: frozenset[str]
    resource_prefixes: tuple[str, ...]
    roles: frozenset[str] = frozenset()
    jurisdictions: frozenset[str] | None = None

    def __post_init__(self) -> None:
        if self.effect not in {"ALLOW", "DENY"}:
            raise ValueError("effect must be ALLOW or DENY")


class GovernedPermissionGraph:
    """Deny-by-default ABAC/RBAC hybrid with tenant and delegation boundaries."""

    def __init__(self, rules: Sequence[PolicyRule], policy_version: str) -> None:
        if not policy_version or not rules:
            raise ValueError("versioned policy rules required")
        if any(r.version != policy_version for r in rules):
            raise ValueError("mixed policy versions are not allowed")
        self.rules = tuple(rules)
        self.policy_version = policy_version

    def authorize(self, principal: Principal, req: AuthorizationRequest) -> dict[str, Any]:
        if not principal.principal_id or not principal.tenant_id:
            raise AuthorizationDenied("authenticated principal and tenant required")
        if principal.tenant_id != req.resource_tenant_id:
            raise AuthorizationDenied("cross-tenant access denied")
        if not req.required_scopes.issubset(principal.scopes):
            raise AuthorizationDenied("required scope missing")
        if principal.delegated_by and not req.required_scopes.issubset(principal.delegation_scopes):
            raise AuthorizationDenied("delegation scope exceeded")
        if req.required_roles and not (req.required_roles & principal.roles):
            raise AuthorizationDenied("required role missing")
        if not req.required_approvals.issubset(principal.approvals):
            raise AuthorizationDenied("required approval missing")
        effective_jurisdiction = req.jurisdiction or principal.jurisdiction
        if req.consequential and not effective_jurisdiction:
            raise AuthorizationDenied("jurisdiction unknown for consequential action")

        matching: list[PolicyRule] = []
        for rule in self.rules:
            if req.action not in rule.actions and "*" not in rule.actions:
                continue
            if not any(req.resource.startswith(prefix) for prefix in rule.resource_prefixes):
                continue
            if rule.roles and not (rule.roles & principal.roles):
                continue
            if rule.jurisdictions is not None and effective_jurisdiction not in rule.jurisdictions:
                continue
            matching.append(rule)
        denied = sorted(r.rule_id for r in matching if r.effect == "DENY")
        allowed = sorted(r.rule_id for r in matching if r.effect == "ALLOW")
        if denied:
            raise AuthorizationDenied("explicit deny: " + ",".join(denied))
        if not allowed:
            raise AuthorizationDenied("no explicit allow rule")
        return {"authorized": True, "policy_version": self.policy_version, "allow_rules": allowed,
                "principal_id": principal.principal_id, "tenant_id": principal.tenant_id,
                "jurisdiction": effective_jurisdiction}


@dataclass(frozen=True)
class Instruction:
    instruction_id: str
    text: str
    authority: str
    source: str
    requested_action: str | None
    consequential: bool
    parent_instruction_id: str | None = None


class InstructionProvenanceFirewall:
    RANK = {"system": 60, "developer": 50, "user": 40, "trusted_tool": 30,
            "retrieved_content": 10, "model_output": 5}
    PROTECTED_PREFIXES = ("credential.", "secret.", "authorization.", "policy.", "deploy.production",
                          "payment.", "trade.", "money_transfer.", "crypto_transfer.")

    @classmethod
    def assess(cls, instruction: Instruction) -> dict[str, Any]:
        if instruction.authority not in cls.RANK:
            return {"allowed": False, "reason": "unknown instruction authority"}
        action = instruction.requested_action or ""
        protected = any(action.startswith(p) for p in cls.PROTECTED_PREFIXES)
        untrusted = instruction.authority in {"retrieved_content", "model_output"}
        if untrusted and (instruction.consequential or protected):
            return {"allowed": False, "reason": "untrusted content cannot authorize consequential action"}
        if protected and cls.RANK[instruction.authority] < cls.RANK["user"]:
            return {"allowed": False, "reason": "authority below user for protected action"}
        return {"allowed": True, "reason": "authority accepted", "instruction_sha256": sha256(asdict(instruction))}

    @classmethod
    def resolve(cls, instructions: Sequence[Instruction]) -> Instruction:
        if not instructions:
            raise ValueError("instructions required")
        ordered = sorted(instructions, key=lambda x: (-cls.RANK.get(x.authority, -1), x.instruction_id))
        top_rank = cls.RANK.get(ordered[0].authority, -1)
        top = [x for x in ordered if cls.RANK.get(x.authority, -1) == top_rank]
        if len({(x.text, x.requested_action) for x in top}) > 1:
            raise FrontierSafetyError("same-authority conflict unresolved")
        return top[0]


@dataclass(frozen=True)
class JurisdictionPolicy:
    jurisdiction: str
    version: str
    effective_from: str
    expires_at: str | None
    provenance: str
    permitted_actions: frozenset[str]

    def __post_init__(self) -> None:
        parse_time(self.effective_from)
        if self.expires_at:
            parse_time(self.expires_at)
        if not self.provenance:
            raise ValueError("jurisdiction policy provenance required")


class PolicyJurisdictionRouter:
    def __init__(self, policies: Sequence[JurisdictionPolicy]) -> None:
        self.policies = tuple(policies)

    def route(self, jurisdiction: str | None, action: str, at: str) -> JurisdictionPolicy:
        if not jurisdiction:
            raise AuthorizationDenied("jurisdiction unknown")
        when = parse_time(at)
        candidates = []
        for p in self.policies:
            if p.jurisdiction != jurisdiction or action not in p.permitted_actions:
                continue
            if parse_time(p.effective_from) > when:
                continue
            if p.expires_at and when >= parse_time(p.expires_at):
                continue
            candidates.append(p)
        if not candidates:
            raise AuthorizationDenied("no fresh authoritative jurisdiction policy")
        return sorted(candidates, key=lambda p: (parse_time(p.effective_from), p.version), reverse=True)[0]
