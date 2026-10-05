from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence

from .core import AuthorizationDenied, FrontierSafetyError, parse_time, sha256


def _validate_resource(value: str, *, pattern: bool = False) -> str:
    if pattern and value == "*":
        return value
    if not value or value.startswith("/") or "\\" in value or "\x00" in value or "//" in value:
        raise ValueError("resource must be a canonical relative path")
    body = value[:-1] if pattern and value.endswith("/") else value
    segments = body.split("/")
    if not body or any(segment in {"", ".", ".."} for segment in segments):
        raise ValueError("resource contains ambiguous path segments")
    return body


def _resource_matches(resource: str, pattern: str) -> bool:
    resource = _validate_resource(resource)
    if pattern == "*":
        return True
    root = _validate_resource(pattern, pattern=True)
    return resource == root or resource.startswith(root + "/")


def _pattern_within(child: str, parent: str) -> bool:
    if parent == "*":
        return True
    if child == "*":
        return parent == "*"
    child_root = _validate_resource(child, pattern=True)
    parent_root = _validate_resource(parent, pattern=True)
    return child_root == parent_root or child_root.startswith(parent_root + "/")


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
    delegation_id: str | None = None


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
    at: str | None = None
    purpose: str | None = None

    def __post_init__(self) -> None:
        if not self.action or not self.resource_tenant_id:
            raise ValueError("authorization action and resource tenant are required")
        _validate_resource(self.resource)
        if self.at:
            parse_time(self.at)


@dataclass(frozen=True)
class PolicyRule:
    rule_id: str
    version: str
    effect: str
    actions: frozenset[str]
    resource_prefixes: tuple[str, ...]
    roles: frozenset[str] = frozenset()
    jurisdictions: frozenset[str] | None = None

    def __post_init__(self) -> None:
        if self.effect not in {"ALLOW", "DENY"}:
            raise ValueError("effect must be ALLOW or DENY")
        if not self.rule_id or not self.version or not self.actions or not self.resource_prefixes:
            raise ValueError("complete policy rule required")
        if any(not action for action in self.actions):
            raise ValueError("empty policy action not allowed")
        for prefix in self.resource_prefixes:
            _validate_resource(prefix, pattern=True)


@dataclass(frozen=True)
class DelegationGrant:
    grant_id: str
    version: str
    delegator_id: str
    delegate_id: str
    tenant_id: str
    scopes: frozenset[str]
    actions: frozenset[str]
    resource_prefixes: tuple[str, ...]
    issued_at: str
    expires_at: str
    purpose: str | None = None
    parent_grant_id: str | None = None

    def __post_init__(self) -> None:
        if not all((self.grant_id, self.version, self.delegator_id, self.delegate_id, self.tenant_id)):
            raise ValueError("complete delegation identity required")
        if self.delegator_id == self.delegate_id:
            raise ValueError("self-delegation is not a delegation boundary")
        if not self.actions or not self.resource_prefixes:
            raise ValueError("delegation actions and resources required")
        for prefix in self.resource_prefixes:
            _validate_resource(prefix, pattern=True)
        issued, expires = parse_time(self.issued_at), parse_time(self.expires_at)
        if expires <= issued:
            raise ValueError("delegation expiry must be after issuance")


class GovernedPermissionGraph:
    """Deny-by-default ABAC/RBAC with tenant, delegation and purpose boundaries."""

    def __init__(self, rules: Sequence[PolicyRule], policy_version: str, *,
                 delegations: Sequence[DelegationGrant] = ()) -> None:
        rules_tuple = tuple(rules)
        delegations_tuple = tuple(delegations)
        if not policy_version or not rules_tuple:
            raise ValueError("versioned policy rules required")
        if any(r.version != policy_version for r in rules_tuple):
            raise ValueError("mixed policy versions are not allowed")
        if any(g.version != policy_version for g in delegations_tuple):
            raise ValueError("delegation policy version mismatch")
        self.rules = rules_tuple
        self.policy_version = policy_version
        self.delegations = {g.grant_id: g for g in delegations_tuple}
        if len(self.delegations) != len(delegations_tuple):
            raise ValueError("duplicate delegation grant id")
        self._validate_delegation_graph()

    def _validate_delegation_graph(self) -> None:
        visiting: set[str] = set()
        verified: set[str] = set()

        def check(grant_id: str) -> None:
            if grant_id in verified:
                return
            if grant_id in visiting:
                raise ValueError("delegation cycle detected")
            grant = self.delegations[grant_id]
            visiting.add(grant_id)
            if grant.parent_grant_id:
                parent = self.delegations.get(grant.parent_grant_id)
                if parent is None:
                    raise ValueError("delegation parent missing")
                check(parent.grant_id)
                if grant.delegator_id != parent.delegate_id:
                    raise ValueError("delegation chain principal mismatch")
                if grant.tenant_id != parent.tenant_id:
                    raise ValueError("delegation chain tenant escalation")
                if not grant.scopes.issubset(parent.scopes):
                    raise ValueError("delegation chain scope escalation")
                if "*" not in parent.actions and not grant.actions.issubset(parent.actions):
                    raise ValueError("delegation chain action escalation")
                if any(not any(_pattern_within(child, outer) for outer in parent.resource_prefixes)
                       for child in grant.resource_prefixes):
                    raise ValueError("delegation chain resource escalation")
                if parse_time(grant.issued_at) < parse_time(parent.issued_at):
                    raise ValueError("delegation child predates parent")
                if parse_time(grant.expires_at) > parse_time(parent.expires_at):
                    raise ValueError("delegation child outlives parent")
                if parent.purpose and grant.purpose != parent.purpose:
                    raise ValueError("delegation chain purpose escalation")
            visiting.remove(grant_id)
            verified.add(grant_id)

        for grant_id in sorted(self.delegations):
            check(grant_id)

    def _authorize_delegation(self, principal: Principal, req: AuthorizationRequest) -> tuple[str, ...]:
        if not principal.delegated_by:
            if principal.delegation_id:
                raise AuthorizationDenied("delegation id present without delegator")
            return ()
        if not principal.delegation_id:
            raise AuthorizationDenied("versioned delegation grant required")
        grant = self.delegations.get(principal.delegation_id)
        if grant is None:
            raise AuthorizationDenied("delegation grant unknown")
        if grant.delegate_id != principal.principal_id or grant.delegator_id != principal.delegated_by:
            raise AuthorizationDenied("delegation principal binding mismatch")
        if grant.tenant_id != principal.tenant_id or grant.tenant_id != req.resource_tenant_id:
            raise AuthorizationDenied("delegation tenant boundary exceeded")
        if not req.at:
            raise AuthorizationDenied("delegated authorization requires request time")
        when = parse_time(req.at)
        if when < parse_time(grant.issued_at) or when >= parse_time(grant.expires_at):
            raise AuthorizationDenied("delegation grant not active")
        if not req.required_scopes.issubset(grant.scopes):
            raise AuthorizationDenied("delegation scope exceeded")
        if principal.delegation_scopes and not req.required_scopes.issubset(principal.delegation_scopes):
            raise AuthorizationDenied("legacy delegation scope guard exceeded")
        if req.action not in grant.actions and "*" not in grant.actions:
            raise AuthorizationDenied("delegation action exceeded")
        if not any(_resource_matches(req.resource, prefix) for prefix in grant.resource_prefixes):
            raise AuthorizationDenied("delegation resource exceeded")
        if grant.purpose and req.purpose != grant.purpose:
            raise AuthorizationDenied("delegation purpose mismatch")

        chain: list[str] = []
        current: DelegationGrant | None = grant
        while current is not None:
            chain.append(current.grant_id)
            current = self.delegations.get(current.parent_grant_id) if current.parent_grant_id else None
        return tuple(chain)

    def authorize(self, principal: Principal, req: AuthorizationRequest) -> dict[str, Any]:
        if not principal.principal_id or not principal.tenant_id:
            raise AuthorizationDenied("authenticated principal and tenant required")
        if principal.tenant_id != req.resource_tenant_id:
            raise AuthorizationDenied("cross-tenant access denied")
        if not req.required_scopes.issubset(principal.scopes):
            raise AuthorizationDenied("required scope missing")
        delegation_chain = self._authorize_delegation(principal, req)
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
            if not any(_resource_matches(req.resource, prefix) for prefix in rule.resource_prefixes):
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
        result = {
            "authorized": True,
            "policy_version": self.policy_version,
            "allow_rules": allowed,
            "principal_id": principal.principal_id,
            "tenant_id": principal.tenant_id,
            "jurisdiction": effective_jurisdiction,
            "delegation_chain": list(delegation_chain),
        }
        result["authorization_sha256"] = sha256({
            "principal": principal.principal_id,
            "tenant": principal.tenant_id,
            "request": asdict(req),
            "policy_version": self.policy_version,
            "allow_rules": allowed,
            "delegation_chain": list(delegation_chain),
        })
        return result


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
