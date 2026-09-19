from __future__ import annotations

import dataclasses
import hmac
from dataclasses import dataclass
from typing import Callable, Mapping

from .common import (
    AuthorizationError,
    IntegrityError,
    canonical_json,
    clean_text,
    destination_allowed,
    ensure_not_downgraded,
    hmac_sha256,
    new_id,
    normalize_risk,
    now_ms,
    require_text,
    risk_index,
    sha256_json,
)


ATOMIC_OPERATIONS = (
    "algebra.expand", "algebra.factor", "algebra.polynomial_roots", "algebra.simplify", "algebra.solve",
    "arithmetic.evaluate", "calculus.diff", "calculus.integrate", "calculus.limit", "calculus.product",
    "calculus.series", "calculus.sum", "combinatorics.binomial", "combinatorics.factorial", "finance.beta",
    "finance.black_scholes", "finance.bond_price", "finance.bond_yield", "finance.compound",
    "finance.cvar_historical", "finance.drawdown", "finance.duration", "finance.greeks", "finance.implied_vol",
    "finance.monte_carlo_gbm", "finance.npv", "finance.portfolio_metrics", "finance.returns",
    "finance.var_historical", "finance.var_parametric", "geometry.area_circle", "geometry.distance",
    "geometry.volume_sphere", "knowledge.constant", "knowledge.element", "linear.det", "linear.eigen",
    "linear.inv", "linear.solve", "numbertheory.factorint", "numbertheory.gcd", "numbertheory.isprime",
    "numbertheory.lcm", "numeric.integrate", "numeric.interpolate", "numeric.least_squares", "numeric.ode",
    "numeric.optimize_scalar", "numeric.root", "optimization.linear_program", "optimization.quadratic",
    "probability.binomial_pmf", "probability.chi2_cdf", "probability.exponential_cdf", "probability.normal_cdf",
    "probability.normal_ppf", "probability.poisson_pmf", "statistics.correlation", "statistics.covariance",
    "statistics.describe", "statistics.normal_fit", "statistics.quantile", "statistics.regression",
    "statistics.ttest_ind", "statistics.zscore", "timeseries.ewma", "timeseries.moving_average",
    "timeseries.rolling_volatility", "transforms.fft", "transforms.ifft", "units.convert",
    "verified.interval_eval", "verify.crosscheck", "verify.evaluate",
)

LANE_ORDER = (
    ("quantitative", 1),
    ("research_source", 2),
    ("artifact_engine", 3),
    ("code_file", 4),
    ("browser_computer", 5),
    ("project_memory_context", 6),
    ("agents_mission_control", 7),
    ("automations_schedules", 8),
    ("mcp_enterprise", 9),
    ("live_multimodal", 10),
)


@dataclass(frozen=True)
class OperationSpec:
    lane: str
    risk_class: str
    external: bool


OPERATION_SPECS = {operation: OperationSpec("quantitative", "S0", False) for operation in ATOMIC_OPERATIONS}
OPERATION_SPECS.update(
    {
        "research.search": OperationSpec("research_source", "S2", True),
        "artifact.write": OperationSpec("artifact_engine", "S1", False),
        "code.execute": OperationSpec("code_file", "S1", False),
        "file.write": OperationSpec("code_file", "S1", False),
        "browser.open": OperationSpec("browser_computer", "S2", True),
        "computer.inspect": OperationSpec("browser_computer", "S2", True),
        "project.read": OperationSpec("project_memory_context", "S0", False),
        "memory.store": OperationSpec("project_memory_context", "S1", False),
        "agent.run": OperationSpec("agents_mission_control", "S1", False),
        "automation.schedule": OperationSpec("automations_schedules", "S3", False),
        "mcp.invoke": OperationSpec("mcp_enterprise", "S2", True),
        "enterprise.read": OperationSpec("mcp_enterprise", "S2", True),
        "live.session": OperationSpec("live_multimodal", "S2", True),
        "voice.session": OperationSpec("live_multimodal", "S2", True),
        "camera.session": OperationSpec("live_multimodal", "S2", True),
        "screen.session": OperationSpec("live_multimodal", "S2", True),
    }
)


@dataclass(frozen=True)
class ExecutionContext:
    organization_id: str
    project_id: str
    actor_id: str
    task_id: str
    step_id: str
    instruction_provenance: str = "GOVERNED_PLAN"
    network_allowlist: tuple[str, ...] = ()

    def __post_init__(self):
        for field in ("organization_id", "project_id", "actor_id", "task_id", "step_id"):
            if not clean_text(getattr(self, field), maximum=200):
                raise AuthorizationError(f"{field} is required")
        if self.instruction_provenance not in {"TRUSTED_USER", "GOVERNED_PLAN", "VERIFIED_SYSTEM", "RETRIEVED_DATA"}:
            raise AuthorizationError("unrecognized instruction provenance")


@dataclass(frozen=True)
class AuthorizationGrant:
    schema: str
    organization_id: str
    project_id: str
    actor_id: str
    task_id: str
    step_id: str
    capability: str
    lane: str
    invocation_id: str
    destination: str
    arguments_sha256: str
    expires_at_ms: int
    signature: str


class ServerAuthorizationBroker:
    def __init__(self, secret_key: bytes):
        if not isinstance(secret_key, bytes) or len(secret_key) < 24:
            raise ValueError("authorization broker key must contain at least 24 bytes")
        self.secret_key = bytes(secret_key)

    @staticmethod
    def _body(grant: AuthorizationGrant):
        return {key: value for key, value in dataclasses.asdict(grant).items() if key != "signature"}

    def issue(
        self,
        context: ExecutionContext,
        *,
        capability,
        lane,
        invocation_id,
        destination,
        arguments,
        ttl_seconds=120,
    ):
        capability = require_text(capability, "capability", maximum=160)
        lane = require_text(lane, "lane", maximum=80)
        invocation_id = require_text(invocation_id, "invocation id", maximum=200)
        destination = require_text(destination, "destination", maximum=2048)
        if not destination_allowed(destination, context.network_allowlist):
            raise AuthorizationError("external destination is outside the server allowlist")
        body = {
            "schema": "musitu.axiom.tool-authorization.v1",
            "organization_id": context.organization_id,
            "project_id": context.project_id,
            "actor_id": context.actor_id,
            "task_id": context.task_id,
            "step_id": context.step_id,
            "capability": capability,
            "lane": lane,
            "invocation_id": invocation_id,
            "destination": destination,
            "arguments_sha256": sha256_json(arguments or {}),
            "expires_at_ms": now_ms() + max(1, min(300, int(ttl_seconds))) * 1000,
        }
        return AuthorizationGrant(**body, signature=hmac_sha256(self.secret_key, canonical_json(body)))

    def verify(
        self,
        grant: AuthorizationGrant,
        *,
        context: ExecutionContext,
        capability,
        lane,
        invocation_id,
        destination,
        arguments,
    ):
        if not isinstance(grant, AuthorizationGrant):
            raise AuthorizationError("server authorization grant is required")
        if grant.schema != "musitu.axiom.tool-authorization.v1":
            raise IntegrityError("authorization grant schema is invalid")
        body = self._body(grant)
        expected = hmac_sha256(self.secret_key, canonical_json(body))
        if not hmac.compare_digest(expected, grant.signature):
            raise IntegrityError("authorization grant signature is invalid")
        exact = {
            "organization_id": context.organization_id,
            "project_id": context.project_id,
            "actor_id": context.actor_id,
            "task_id": context.task_id,
            "step_id": context.step_id,
            "capability": capability,
            "lane": lane,
            "invocation_id": invocation_id,
            "destination": destination,
            "arguments_sha256": sha256_json(arguments or {}),
        }
        for key, value in exact.items():
            if getattr(grant, key) != value:
                raise IntegrityError(f"authorization grant {key} binding mismatch")
        if grant.expires_at_ms <= now_ms():
            raise AuthorizationError("authorization grant expired")
        if not destination_allowed(destination, context.network_allowlist):
            raise AuthorizationError("external destination is outside the server allowlist")
        return True


@dataclass(frozen=True)
class Invocation:
    schema: str
    invocation_id: str
    capability: str
    lane: str
    adapter_id: str
    arguments: Mapping
    context: ExecutionContext
    request_sha256: str


@dataclass(frozen=True)
class AdapterBinding:
    lane: str
    adapter_id: str
    operations: frozenset[str]
    adapter: Callable[[Invocation], Mapping]
    qualification: str
    external: bool = False

    def __post_init__(self):
        lanes = {lane for lane, _ in LANE_ORDER}
        if self.lane not in lanes:
            raise AuthorizationError("unknown tool-fabric lane")
        if not clean_text(self.adapter_id, maximum=160) or not callable(self.adapter):
            raise AuthorizationError("invalid tool-fabric adapter")
        if not self.operations:
            raise AuthorizationError("adapter must declare at least one operation")
        if self.qualification not in {"LOCAL_CANDIDATE_EXECUTABLE", "SOURCE_BOUND_NOT_EXECUTED", "SYNTHETIC_TEST_ONLY"}:
            raise AuthorizationError("builder cannot self-certify a production adapter")

    @classmethod
    def local_candidate(cls, *, lane, adapter_id, operations, adapter, external=False):
        return cls(
            lane=lane,
            adapter_id=adapter_id,
            operations=frozenset(operations),
            adapter=adapter,
            qualification="LOCAL_CANDIDATE_EXECUTABLE",
            external=bool(external),
        )


class UnifiedToolFabric:
    def __init__(self):
        self._operation_bindings: dict[str, AdapterBinding] = {}

    def operation_spec(self, capability) -> OperationSpec:
        capability = clean_text(capability, maximum=160)
        spec = OPERATION_SPECS.get(capability)
        if not spec:
            raise AuthorizationError("capability is not registered in the unified fabric")
        return spec

    def risk_for(self, capability, supplied=None):
        return ensure_not_downgraded(self.operation_spec(capability).risk_class, supplied)

    def bind(self, binding: AdapterBinding):
        if not isinstance(binding, AdapterBinding):
            raise TypeError("AdapterBinding is required")
        for operation in binding.operations:
            spec = self.operation_spec(operation)
            if spec.lane != binding.lane:
                raise AuthorizationError("adapter lane does not match operation registry")
            if spec.external != binding.external:
                raise AuthorizationError("adapter external boundary does not match operation registry")
            if operation in self._operation_bindings:
                raise ConflictError(f"operation already bound: {operation}")
        for operation in binding.operations:
            self._operation_bindings[operation] = binding

    def invoke(
        self,
        capability,
        arguments,
        context: ExecutionContext,
        invocation_id,
        *,
        authorization=None,
        authorization_broker=None,
    ):
        capability = clean_text(capability, maximum=160)
        invocation_id = clean_text(invocation_id, maximum=200)
        if not invocation_id:
            raise AuthorizationError("stable invocation id is required")
        spec = self.operation_spec(capability)
        binding = self._operation_bindings.get(capability)
        if binding is None:
            raise AuthorizationError(f"registered capability is not bound: {capability}")
        if context.instruction_provenance == "RETRIEVED_DATA" and risk_index(spec.risk_class) >= risk_index("S1"):
            raise AuthorizationError("retrieved data cannot authorize a side effect")
        args = dict(arguments or {})
        if spec.external:
            destination = clean_text(args.get("destination"), maximum=2048)
            if not authorization_broker:
                raise AuthorizationError("external adapter requires the server authorization broker")
            authorization_broker.verify(
                authorization,
                context=context,
                capability=capability,
                lane=spec.lane,
                invocation_id=invocation_id,
                destination=destination,
                arguments=args,
            )
        request = {
            "schema": "musitu.axiom.tool-invocation.v1",
            "invocation_id": invocation_id,
            "capability": capability,
            "lane": spec.lane,
            "adapter_id": binding.adapter_id,
            "arguments": args,
            "organization_id": context.organization_id,
            "project_id": context.project_id,
            "actor_id": context.actor_id,
            "task_id": context.task_id,
            "step_id": context.step_id,
            "instruction_provenance": context.instruction_provenance,
        }
        invocation = Invocation(
            schema=request["schema"],
            invocation_id=invocation_id,
            capability=capability,
            lane=spec.lane,
            adapter_id=binding.adapter_id,
            arguments=args,
            context=context,
            request_sha256=sha256_json(request),
        )
        result = dict(binding.adapter(invocation))
        receipt_body = {
            "schema": "musitu.axiom.tool-receipt.v1",
            "receipt_id": new_id("tool_receipt"),
            "invocation_id": invocation_id,
            "request_sha256": invocation.request_sha256,
            "capability": capability,
            "lane": spec.lane,
            "adapter_id": binding.adapter_id,
            "qualification": binding.qualification,
            "external": binding.external,
            "result": result,
            "result_sha256": sha256_json(result),
            "created_at_ms": now_ms(),
        }
        return {**receipt_body, "receipt_sha256": sha256_json(receipt_body)}

    def gate_state(self):
        lanes = {lane for lane, _ in LANE_ORDER}
        bound_lanes = {binding.lane for binding in self._operation_bindings.values()}
        local_coverage = sorted(self._operation_bindings)
        return {
            "schema": "musitu.axiom.ar06.fabric-state.v1",
            "certified_atomic_registry_count": len(ATOMIC_OPERATIONS),
            "registered_operation_count": len(OPERATION_SPECS),
            "locally_bound_operation_count": len(local_coverage),
            "locally_bound_operations": local_coverage,
            "ordered_lane_count": len(LANE_ORDER),
            "all_lanes_locally_bound": bound_lanes == lanes,
            "all_registered_operations_locally_bound": len(local_coverage) == len(OPERATION_SPECS),
            "all_lanes_live_production_proven": False,
            "independent_production_qualification": False,
            "ar06_gate_earned": False,
            "reason": "local candidate bindings cannot self-certify live production execution",
            "superiority": "NOT_CERTIFIED",
        }


# Local import to keep the public failure class near the binding operation.
from .common import ConflictError  # noqa: E402
