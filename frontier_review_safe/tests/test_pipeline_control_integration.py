from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.core import Evidence
from frontier_review_safe.evaluation import DecisionProvenanceLedger
from frontier_review_safe.governance import (
    AuthorizationRequest,
    GovernedPermissionGraph,
    Instruction,
    JurisdictionPolicy,
    PolicyJurisdictionRouter,
    PolicyRule,
    Principal,
)
from frontier_review_safe.model_risk import ModelRegistration, ModelRiskGovernance
from frontier_review_safe.orchestration import ProviderState, SpecialistContract, SpecialistResult, SpecialistSociety
from frontier_review_safe.pipeline import ReviewSafeWorkflow, WorkflowAdapters, WorkflowRequest
from frontier_review_safe.routing import CostLatencyQualityRouter
from frontier_review_safe.verification import VerificationPath

NOW = datetime(2026, 9, 11, 7, 0, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
H = "a" * 64


def evidence() -> Evidence:
    return Evidence("e1", "fact", True, "source", NOW_S, .95, True, .9, .9, 1, 1, 0, 0, "g1")


def principal() -> Principal:
    return Principal("u", "t", frozenset({"analyst"}), frozenset({"research"}), "ZW")


def permissions() -> GovernedPermissionGraph:
    return GovernedPermissionGraph([
        PolicyRule("allow", "p1", "ALLOW", frozenset({"research"}), ("research/",),
                   frozenset({"analyst"}), frozenset({"ZW"}))
    ], "p1")


def jurisdictions() -> PolicyJurisdictionRouter:
    return PolicyJurisdictionRouter([
        JurisdictionPolicy(
            "ZW", "j1", (NOW - timedelta(days=1)).isoformat(),
            (NOW + timedelta(days=1)).isoformat(), "gazette",
            frozenset({"research"}),
        )
    ])


def specialists() -> tuple[SpecialistSociety, tuple[SpecialistContract, ...]]:
    handlers = {
        "a": lambda task: SpecialistResult("a", "lane-a", "ok", .9, ("e1",)),
        "b": lambda task: SpecialistResult("b", "lane-b", "ok", .9, ("e1",), dissent="alternate checked"),
    }
    contracts = (
        SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
        SpecialistContract("b", "risk", "lane-b", .2, 0, 1),
    )
    return SpecialistSociety(handlers), contracts


def verifiers() -> tuple[VerificationPath, ...]:
    return (
        VerificationPath("v1", "invariant", None, lambda r: r["value"] == 42),
        VerificationPath(
            "v2", "alternate", "provider-independent", lambda r: r["value"] == 42,
            origin="provider:provider-independent", provenance_hash=H, requires_external_origin=True,
        ),
    )


def model_registry() -> ModelRiskGovernance:
    registry = ModelRiskGovernance()
    registry.register(ModelRegistration(
        "m1", "v1", "risk-analysis", frozenset({"risk"}), H, "b" * 64,
        True, True, "approval-v1", NOW_S, 3600, ("bounded risk model",), None,
    ))
    return registry


def request(request_id: str, **overrides) -> WorkflowRequest:
    values = dict(
        request_id=request_id,
        question="analyze portfolio risk",
        action="research",
        domain="risk",
        principal=principal(),
        authorization_request=AuthorizationRequest(
            "research", "research/report", "t", frozenset({"research"}),
            frozenset({"analyst"}), jurisdiction="ZW", consequential=True,
        ),
        instruction=Instruction("i", "analyze", "user", "user", "research", True),
        now=NOW_S,
        min_source_quality=.4,
        min_confidence=.8,
        max_uncertainty=.3,
        policy_version="p1",
        code_version="candidate",
        high_consequence=True,
    )
    values.update(overrides)
    return WorkflowRequest(**values)


def analysis(model_version: str = "v1"):
    return {
        "value": 42,
        "confidence": .9,
        "uncertainty": .1,
        "contradiction_status": "RESOLVED",
        "stale_data": False,
        "causal_supported": True,
        "evaluation_boundary_exceeded": False,
        "model_version": model_version,
        "method": "independent verification",
        "assumptions": ["inputs audited"],
    }


class PipelineControlIntegrationTests(unittest.TestCase):
    def _flow(self, *, provider: ProviderState | None = None, with_model_risk: bool = True):
        society, contracts = specialists()
        return ReviewSafeWorkflow(
            permissions=permissions(),
            jurisdictions=jurisdictions(),
            router=CostLatencyQualityRouter([provider or ProviderState(
                "route-a", .95, .9, .99, 10, .1, True,
                capabilities=frozenset({"risk"}), jurisdictions=frozenset({"ZW"}),
            )]),
            specialists=society,
            specialist_contracts=contracts,
            verifier_paths=verifiers(),
            ledger=DecisionProvenanceLedger(),
            model_risk=model_registry() if with_model_risk else None,
        )

    def test_public_trade_effect_is_denied_before_evidence_adapter(self):
        flow = self._flow()
        called = {"evidence": False}
        req = request(
            "public-deny",
            public_surface=True,
            intent_effects=frozenset({"read", "investment_trade"}),
        )
        out = flow.execute(req, WorkflowAdapters(
            lambda r: (called.__setitem__("evidence", True) or [evidence()]),
            lambda *args: analysis(),
        ))
        self.assertEqual(out["status"], "ABSTAIN")
        self.assertIn("commercial_intent_denied", out["reasons"])
        self.assertFalse(called["evidence"])
        self.assertEqual(out["trace"][-1]["stage"], "commercial_intent")

    def test_configured_model_risk_requires_exact_model_identity_before_evidence(self):
        flow = self._flow()
        called = {"evidence": False}
        out = flow.execute(request("missing-model"), WorkflowAdapters(
            lambda r: (called.__setitem__("evidence", True) or [evidence()]),
            lambda *args: analysis(),
        ))
        self.assertEqual(out["status"], "ABSTAIN")
        self.assertIn("model_risk_identity_missing", out["reasons"])
        self.assertFalse(called["evidence"])
        self.assertEqual(out["trace"][-1]["stage"], "model_risk")

    def test_registered_model_public_intent_and_contextual_route_are_proof_bound(self):
        flow = self._flow()
        req = request(
            "integrated-pass",
            public_surface=True,
            intent_effects=frozenset({"read", "research"}),
            model_id="m1",
            model_version="v1",
        )
        out = flow.execute(req, WorkflowAdapters(lambda r: [evidence()], lambda *args: analysis("v1")))
        self.assertEqual(out["status"], "PASS")
        stages = [row["stage"] for row in out["trace"]]
        self.assertIn("commercial_intent", stages)
        self.assertIn("model_risk", stages)
        self.assertIn("routing", stages)
        authorization = out["proof"]["authorization"]
        self.assertEqual(len(authorization["commercial_intent_sha256"]), 64)
        self.assertEqual(len(authorization["model_risk_sha256"]), 64)

    def test_analysis_cannot_substitute_different_model_version_after_authorization(self):
        flow = self._flow()
        req = request("model-mismatch", model_id="m1", model_version="v1")
        out = flow.execute(req, WorkflowAdapters(lambda r: [evidence()], lambda *args: analysis("v2")))
        self.assertEqual(out["status"], "ABSTAIN")
        self.assertIn("analysis_model_version_mismatch", out["reasons"])

    def test_router_receives_domain_and_jurisdiction_and_fails_closed_on_mismatch(self):
        provider = ProviderState(
            "wrong-jurisdiction", .99, .99, .99, 1, 0, True,
            capabilities=frozenset({"risk"}), jurisdictions=frozenset({"US"}),
        )
        flow = self._flow(provider=provider, with_model_risk=False)
        req = request("route-mismatch", high_consequence=False)
        out = flow.execute(req, WorkflowAdapters(lambda r: [evidence()], lambda *args: analysis()))
        self.assertEqual(out["status"], "ABSTAIN")
        self.assertIn("capability_route_unavailable", out["reasons"])

    def test_explicit_model_identity_without_registry_fails_closed(self):
        flow = self._flow(with_model_risk=False)
        req = request("registry-missing", high_consequence=False, model_id="m1", model_version="v1")
        out = flow.execute(req, WorkflowAdapters(lambda r: [evidence()], lambda *args: analysis()))
        self.assertEqual(out["status"], "ABSTAIN")
        self.assertIn("model_risk_registry_unavailable", out["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
