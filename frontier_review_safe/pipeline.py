from __future__ import annotations

from dataclasses import asdict, dataclass, field
from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable, Mapping, Sequence

from .commercial_intent import CommercialIntentQualifier, CommercialIntentRequest
from .core import DataLineageContract, Evidence, LineageStep, sha256, utcnow
from .evidence_resolution import ResearchSourceScorer, SourceQualityProfile
from .evaluation import DecisionProvenanceLedger, ProofEnvelope
from .governance import (AuthorizationRequest, GovernedPermissionGraph, Instruction,
                         InstructionProvenanceFirewall, PolicyJurisdictionRouter, Principal)
from .model_risk import ModelRiskGovernance
from .orchestration import (CostLatencyQualityRouter, FailClosedAbstentionPolicy, AbstentionContext,
                            SpecialistContract, SpecialistSociety)
from .specialist_governance import GovernedSpecialistDeliberation, SpecialistGovernancePolicy
from .verification import IndependentVerifier, VerificationPath


@dataclass(frozen=True)
class WorkflowRequest:
    request_id: str
    question: str
    action: str
    domain: str
    principal: Principal
    authorization_request: AuthorizationRequest
    instruction: Instruction
    now: str
    min_source_quality: float
    min_confidence: float
    max_uncertainty: float
    policy_version: str
    code_version: str
    high_consequence: bool = False
    public_surface: bool = False
    intent_effects: frozenset[str] = frozenset()
    intent_resource_kind: str | None = None
    intent_target: str | None = None
    model_id: str | None = None
    model_version: str | None = None


@dataclass(frozen=True)
class WorkflowAdapters:
    acquire_evidence: Callable[[WorkflowRequest], Sequence[Evidence]]
    analyze: Callable[[WorkflowRequest, Sequence[Evidence], Mapping[str, Any]], Mapping[str, Any]]
    cancellation_requested: Callable[[], bool] = lambda: False
    source_profiles: Mapping[str, SourceQualityProfile] = field(default_factory=dict)


class ReviewSafeWorkflow:
    """Fail-closed cross-module execution contract for consequential analysis."""

    def __init__(self, *, permissions: GovernedPermissionGraph, jurisdictions: PolicyJurisdictionRouter,
                 router: CostLatencyQualityRouter, specialists: SpecialistSociety,
                 specialist_contracts: Sequence[SpecialistContract], verifier_paths: Sequence[VerificationPath],
                 ledger: DecisionProvenanceLedger,
                 specialist_policy: SpecialistGovernancePolicy | None = None,
                 model_risk: ModelRiskGovernance | None = None) -> None:
        self.permissions = permissions
        self.jurisdictions = jurisdictions
        self.router = router
        self.specialists = specialists
        self.specialist_contracts = tuple(specialist_contracts)
        self.verifier_paths = tuple(verifier_paths)
        self.ledger = ledger
        self.specialist_policy = specialist_policy or SpecialistGovernancePolicy()
        self.model_risk = model_risk

    @staticmethod
    def _bounded_call(fn: Callable[[], Any], timeout_seconds: float) -> Any:
        if timeout_seconds <= 0:
            raise ValueError("positive timeout required")
        q: Queue[tuple[bool, Any]] = Queue(maxsize=1)
        def worker():
            try: q.put((True, fn()))
            except BaseException as exc: q.put((False, exc))
        Thread(target=worker, daemon=True).start()
        try: ok, value = q.get(timeout=timeout_seconds)
        except Empty as exc: raise TimeoutError("workflow adapter timeout") from exc
        if not ok: raise value
        return value

    def _abstain(self, req: WorkflowRequest, trace: Sequence[Mapping[str, Any]], reasons: Sequence[str], *,
                 error_type: str | None = None, verification: Mapping[str, Any] | None = None,
                 input_hashes: Sequence[str] = (), tool_versions: Mapping[str, str] | None = None) -> dict[str, Any]:
        """Persist every abstention before returning it to the caller.

        The ledger payload intentionally stores trace fingerprints rather than raw
        intermediate values or exception messages. This keeps denial evidence
        replayable without turning the audit log into a secondary secret sink.
        """
        normalized_reasons = sorted({str(x) for x in reasons if str(x)}) or ["unspecified_abstention"]
        trace_summary = [
            {"stage": str(row.get("stage", "unknown")), "sha256": str(row.get("sha256", ""))}
            for row in trace
        ]
        payload: dict[str, Any] = {
            "status": "ABSTAIN",
            "reasons": normalized_reasons,
            "failed_stage": trace_summary[-1]["stage"] if trace_summary else "request_entry",
            "trace": trace_summary,
        }
        if error_type:
            payload["error_type"] = str(error_type)
        if verification is not None:
            payload["verification_sha256"] = sha256(verification)
        decision_hash = self.ledger.append(
            "analysis.abstain",
            req.principal.principal_id,
            payload,
            request_id=req.request_id,
            policy_version=req.policy_version,
            code_version=req.code_version,
            input_hashes=tuple(input_hashes),
            tool_versions=dict(tool_versions or {}),
        )
        out: dict[str, Any] = {
            "status": "ABSTAIN",
            "reasons": normalized_reasons,
            "trace": list(trace),
            "decision_event_hash": decision_hash,
        }
        if error_type:
            out["error_type"] = str(error_type)
        if verification is not None:
            out["verification"] = dict(verification)
        return out

    @staticmethod
    def _specialist_abstention_reason(deliberation: Mapping[str, Any]) -> str:
        reason = str(deliberation.get("reason", ""))
        governed_reasons = {
            "specialist_deadlock",
            "specialist_retry_budget_not_reserved",
            "specialist_domain_mismatch",
            "specialist_unbound_evidence",
            "specialist_evidence_quorum_failed",
            "specialist_failure_fraction_exceeded",
            "specialist_quorum_not_configured",
            "duplicate_specialist_identity",
            "duplicate_specialist_lane",
            "specialist_task_domain_missing",
            "specialist_task_evidence_missing",
            "specialist_successful_lane_quorum_failed",
            "specialist_mean_confidence_below_policy",
            "specialist_confidence_spread_exceeded",
            "minority_dissent_not_recorded",
        }
        if reason in governed_reasons:
            return reason
        status = str(deliberation.get("status", "UNKNOWN")).upper()
        if status == "VETO":
            return "specialist_veto"
        if status == "ABSTAIN":
            return "specialist_abstain"
        return "specialist_deliberation_unresolved"

    def execute(self, req: WorkflowRequest, adapters: WorkflowAdapters, *, evidence_timeout_seconds: float = 10.0,
                analysis_timeout_seconds: float = 20.0, specialist_budget: int = 8) -> dict[str, Any]:
        trace: list[dict[str, Any]] = []
        def checkpoint(stage: str, value: Any):
            trace.append({"stage": stage, "sha256": sha256(value), "at": utcnow()})
            if adapters.cancellation_requested():
                raise RuntimeError("workflow cancelled")

        firewall = InstructionProvenanceFirewall.assess(req.instruction)
        checkpoint("instruction_provenance", firewall)
        if not firewall.get("allowed"):
            return self._abstain(req, trace, ["instruction_provenance_denied"])

        commercial_decision: Mapping[str, Any] | None = None
        if req.public_surface:
            commercial_request = CommercialIntentRequest(
                action=req.action,
                public_surface=True,
                description=req.question,
                consequential=req.high_consequence,
                effects=req.intent_effects,
                resource_kind=req.intent_resource_kind,
                target=req.intent_target,
            )
            commercial_decision = CommercialIntentQualifier.qualify(commercial_request)
            checkpoint("commercial_intent", commercial_decision)
            if commercial_decision.get("status") != "ALLOW":
                return self._abstain(
                    req,
                    trace,
                    ["commercial_intent_denied", str(commercial_decision.get("reason", "intent_not_allowed"))],
                )

        try:
            authorization = self.permissions.authorize(req.principal, req.authorization_request)
        except Exception as exc:
            return self._abstain(req, trace, ["authorization_denied"], error_type=type(exc).__name__)
        checkpoint("authorization", authorization)

        if req.high_consequence:
            try:
                policy = self.jurisdictions.route(req.principal.jurisdiction, req.action, req.now)
                checkpoint("jurisdiction", asdict(policy))
            except Exception as exc:
                return self._abstain(req, trace, ["jurisdiction_policy_unavailable"], error_type=type(exc).__name__)

        model_risk_decision: Mapping[str, Any] | None = None
        model_identity_requested = bool(req.model_id or req.model_version)
        if model_identity_requested or (req.high_consequence and self.model_risk is not None):
            if not req.model_id or not req.model_version:
                checkpoint("model_risk", {"status": "ABSTAIN", "reason": "model_identity_missing"})
                return self._abstain(req, trace, ["model_risk_identity_missing"])
            if self.model_risk is None:
                checkpoint("model_risk", {"status": "ABSTAIN", "reason": "model_risk_registry_unavailable"})
                return self._abstain(req, trace, ["model_risk_registry_unavailable"])
            model_risk_decision = self.model_risk.authorize_use(
                req.model_id,
                req.model_version,
                req.domain,
                req.now,
                high_consequence=req.high_consequence,
            )
            checkpoint("model_risk", model_risk_decision)
            if model_risk_decision.get("status") != "PASS":
                return self._abstain(
                    req,
                    trace,
                    ["model_risk_denied", *model_risk_decision.get("reasons", [])],
                )

        try:
            evidence = tuple(self._bounded_call(lambda: adapters.acquire_evidence(req), evidence_timeout_seconds))
        except Exception as exc:
            return self._abstain(req, trace, ["evidence_provider_failure"], error_type=type(exc).__name__)
        if not evidence:
            return self._abstain(req, trace, ["evidence_missing"])
        source_quality = [
            ResearchSourceScorer.diagnostics(e, adapters.source_profiles.get(e.source_id))
            for e in evidence
        ]
        scores = [row["score"] for row in source_quality]
        checkpoint("evidence", {
            "hashes": [e.fingerprint for e in evidence],
            "scores": scores,
            "source_quality_sha256": sha256(source_quality),
        })
        evidence_hashes = tuple(e.fingerprint for e in evidence)
        weak = sum(1 for x in scores if x < req.min_source_quality)

        try:
            route_result = self.router.route(
                req.now,
                req.min_confidence,
                capability=req.domain,
                jurisdiction=req.principal.jurisdiction,
            )
            route = route_result["provider"]
        except Exception as exc:
            return self._abstain(req, trace, ["capability_route_unavailable"], error_type=type(exc).__name__,
                                 input_hashes=evidence_hashes)
        checkpoint("routing", {
            "provider": asdict(route),
            "selection_score": route_result.get("selection_score"),
            "degradation_state": route_result.get("degradation_state"),
            "selection_sha256": route_result.get("selection_sha256"),
            "fallbacks": [p.name for p in route_result.get("fallbacks", ())],
            "policy_version": route_result.get("policy_version"),
        })
        route_tools = {"route": route.name}

        specialist_task = {
            "request": req.question,
            "domain": req.domain,
            "evidence": [asdict(e) for e in evidence],
        }
        try:
            if req.high_consequence:
                deliberation = GovernedSpecialistDeliberation.deliberate(
                    self.specialists,
                    self.specialist_contracts,
                    specialist_task,
                    specialist_budget,
                    self.specialist_policy,
                )
            else:
                deliberation = self.specialists.deliberate(
                    self.specialist_contracts,
                    specialist_task,
                    specialist_budget,
                )
        except Exception as exc:
            return self._abstain(req, trace, ["specialist_deliberation_failed"], error_type=type(exc).__name__,
                                 input_hashes=evidence_hashes, tool_versions=route_tools)
        checkpoint("specialists", deliberation)
        if deliberation.get("status") != "OK":
            return self._abstain(
                req,
                trace,
                [self._specialist_abstention_reason(deliberation)],
                input_hashes=evidence_hashes,
                tool_versions=route_tools,
            )

        try:
            analysis = dict(self._bounded_call(lambda: adapters.analyze(req, evidence, deliberation), analysis_timeout_seconds))
        except Exception as exc:
            return self._abstain(req, trace, ["analysis_failure"], error_type=type(exc).__name__,
                                 input_hashes=evidence_hashes, tool_versions=route_tools)
        checkpoint("analysis", analysis)
        if req.model_version is not None and str(analysis.get("model_version", "")) != req.model_version:
            return self._abstain(
                req,
                trace,
                ["analysis_model_version_mismatch"],
                input_hashes=evidence_hashes,
                tool_versions=route_tools,
            )
        confidence = float(analysis.get("confidence", 0.0))
        uncertainty = float(analysis.get("uncertainty", 1.0))
        contradiction_status = str(analysis.get("contradiction_status", "RESOLVED"))
        stale = bool(analysis.get("stale_data", False))
        causal_supported = bool(analysis.get("causal_supported", True))
        eval_boundary = bool(analysis.get("evaluation_boundary_exceeded", False))

        verification = IndependentVerifier.verify(
            analysis,
            self.verifier_paths,
            require_separate_origin=req.high_consequence,
        ) if self.verifier_paths else {"status": "ESCALATE"}
        checkpoint("verification", verification)
        provider_ok = verification.get("status") == "PASS"
        abstention = FailClosedAbstentionPolicy.decide(AbstentionContext(
            True, len(evidence) - weak, max(1, len(evidence)), uncertainty, req.max_uncertainty,
            contradiction_status, stale, causal_supported, provider_ok, not eval_boundary
        ))
        if confidence < req.min_confidence:
            abstention = {"status": "ABSTAIN", "reasons": sorted(set(abstention.get("reasons", [])) | {"confidence_below_request_threshold"})}
        checkpoint("abstention", abstention)
        if abstention.get("status") != "PROCEED":
            return self._abstain(req, trace, abstention.get("reasons", []), verification=verification,
                                 input_hashes=evidence_hashes, tool_versions=route_tools)

        steps = []
        known_inputs = evidence_hashes
        previous = known_inputs
        for i, row in enumerate(trace):
            out = sha256(row)
            steps.append(LineageStep(f"stage-{i:02d}", row["stage"], tuple(previous), out, req.code_version,
                                     analysis.get("model_version"), route.name, req.policy_version, (), row["at"]))
            previous = (out,)
        lineage_hash = DataLineageContract.fingerprint(steps, initial_inputs=known_inputs)
        decision_hash = self.ledger.append("analysis.decision", req.principal.principal_id, analysis,
                                           request_id=req.request_id, policy_version=req.policy_version,
                                           code_version=req.code_version, input_hashes=known_inputs,
                                           model_version=analysis.get("model_version"), tool_versions=route_tools)
        proof_authorization = dict(authorization)
        if commercial_decision is not None:
            proof_authorization["commercial_intent_sha256"] = sha256(commercial_decision)
        if model_risk_decision is not None:
            proof_authorization["model_risk_sha256"] = sha256(model_risk_decision)
        proof = ProofEnvelope(sha256({"question": req.question, "action": req.action}), known_inputs,
                              tuple(analysis.get("assumptions", ("explicit_inputs_only",))),
                              str(analysis.get("method", "unspecified")), sha256(analysis),
                              {"confidence": confidence, "uncertainty": uncertainty}, verification,
                              proof_authorization, lineage_hash, decision_hash, req.code_version,
                              req.policy_version, utcnow())
        return {"status": "PASS", "result": analysis, "proof": asdict(proof),
                "proof_sha256": proof.fingerprint, "trace": trace}
