from __future__ import annotations

from dataclasses import asdict, dataclass
from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable, Mapping, Sequence

from .core import DataLineageContract, Evidence, LineageStep, ResearchSourceScorer, sha256, utcnow
from .evaluation import DecisionProvenanceLedger, ProofEnvelope
from .governance import (AuthorizationRequest, GovernedPermissionGraph, Instruction,
                         InstructionProvenanceFirewall, PolicyJurisdictionRouter, Principal)
from .orchestration import (CostLatencyQualityRouter, FailClosedAbstentionPolicy, AbstentionContext,
                            IndependentVerifier, SpecialistContract, SpecialistSociety, VerificationPath)


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


@dataclass(frozen=True)
class WorkflowAdapters:
    acquire_evidence: Callable[[WorkflowRequest], Sequence[Evidence]]
    analyze: Callable[[WorkflowRequest, Sequence[Evidence], Mapping[str, Any]], Mapping[str, Any]]
    cancellation_requested: Callable[[], bool] = lambda: False


class ReviewSafeWorkflow:
    """Fail-closed cross-module execution contract for consequential analysis."""

    def __init__(self, *, permissions: GovernedPermissionGraph, jurisdictions: PolicyJurisdictionRouter,
                 router: CostLatencyQualityRouter, specialists: SpecialistSociety,
                 specialist_contracts: Sequence[SpecialistContract], verifier_paths: Sequence[VerificationPath],
                 ledger: DecisionProvenanceLedger) -> None:
        self.permissions = permissions
        self.jurisdictions = jurisdictions
        self.router = router
        self.specialists = specialists
        self.specialist_contracts = tuple(specialist_contracts)
        self.verifier_paths = tuple(verifier_paths)
        self.ledger = ledger

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
            return {"status": "ABSTAIN", "reasons": ["instruction_provenance_denied"], "trace": trace}

        try:
            authorization = self.permissions.authorize(req.principal, req.authorization_request)
        except Exception as exc:
            return {"status": "ABSTAIN", "reasons": ["authorization_denied"], "error_type": type(exc).__name__, "trace": trace}
        checkpoint("authorization", authorization)

        if req.high_consequence:
            try:
                policy = self.jurisdictions.route(req.principal.jurisdiction, req.action, req.now)
                checkpoint("jurisdiction", asdict(policy))
            except Exception as exc:
                return {"status": "ABSTAIN", "reasons": ["jurisdiction_policy_unavailable"],
                        "error_type": type(exc).__name__, "trace": trace}

        try:
            evidence = tuple(self._bounded_call(lambda: adapters.acquire_evidence(req), evidence_timeout_seconds))
        except Exception as exc:
            return {"status": "ABSTAIN", "reasons": ["evidence_provider_failure"], "error_type": type(exc).__name__, "trace": trace}
        if not evidence:
            return {"status": "ABSTAIN", "reasons": ["evidence_missing"], "trace": trace}
        scores = [ResearchSourceScorer.score(e) for e in evidence]
        checkpoint("evidence", {"hashes": [e.fingerprint for e in evidence], "scores": scores})
        weak = sum(1 for x in scores if x < req.min_source_quality)

        try:
            route = self.router.route(req.now, req.min_confidence)["provider"]
        except Exception as exc:
            return {"status": "ABSTAIN", "reasons": ["capability_route_unavailable"], "error_type": type(exc).__name__, "trace": trace}
        checkpoint("routing", asdict(route))

        try:
            deliberation = self.specialists.deliberate(self.specialist_contracts,
                                                       {"request": req.question, "evidence": [asdict(e) for e in evidence]},
                                                       specialist_budget)
        except Exception as exc:
            return {"status": "ABSTAIN", "reasons": ["specialist_deliberation_failed"], "error_type": type(exc).__name__, "trace": trace}
        checkpoint("specialists", deliberation)
        if deliberation.get("status") == "VETO":
            return {"status": "ABSTAIN", "reasons": ["specialist_veto"], "trace": trace}

        try:
            analysis = dict(self._bounded_call(lambda: adapters.analyze(req, evidence, deliberation), analysis_timeout_seconds))
        except Exception as exc:
            return {"status": "ABSTAIN", "reasons": ["analysis_failure"], "error_type": type(exc).__name__, "trace": trace}
        checkpoint("analysis", analysis)
        confidence = float(analysis.get("confidence", 0.0))
        uncertainty = float(analysis.get("uncertainty", 1.0))
        contradiction_status = str(analysis.get("contradiction_status", "RESOLVED"))
        stale = bool(analysis.get("stale_data", False))
        causal_supported = bool(analysis.get("causal_supported", True))
        eval_boundary = bool(analysis.get("evaluation_boundary_exceeded", False))

        verification = IndependentVerifier.verify(analysis, self.verifier_paths) if self.verifier_paths else {"status": "ESCALATE"}
        checkpoint("verification", verification)
        provider_ok = verification.get("status") == "PASS"
        abstention = FailClosedAbstentionPolicy.decide(AbstentionContext(
            True, len(evidence) - weak, max(1, len(evidence)), uncertainty, req.max_uncertainty,
            contradiction_status, stale, causal_supported, provider_ok, not eval_boundary
        ))
        # Explicitly add the request threshold; the generic policy has its own confidence field semantics.
        if confidence < req.min_confidence:
            abstention = {"status": "ABSTAIN", "reasons": sorted(set(abstention.get("reasons", [])) | {"confidence_below_request_threshold"})}
        checkpoint("abstention", abstention)
        if abstention.get("status") != "PROCEED":
            return {"status": "ABSTAIN", "reasons": abstention.get("reasons", []), "trace": trace,
                    "verification": verification}

        steps = []
        known_inputs = tuple(e.fingerprint for e in evidence)
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
                                           model_version=analysis.get("model_version"), tool_versions={"route": route.name})
        proof = ProofEnvelope(sha256({"question": req.question, "action": req.action}), known_inputs,
                              tuple(analysis.get("assumptions", ("explicit_inputs_only",))),
                              str(analysis.get("method", "unspecified")), sha256(analysis),
                              {"confidence": confidence, "uncertainty": uncertainty}, verification,
                              authorization, lineage_hash, decision_hash, req.code_version,
                              req.policy_version, utcnow())
        return {"status": "PASS", "result": analysis, "proof": asdict(proof),
                "proof_sha256": proof.fingerprint, "trace": trace}
