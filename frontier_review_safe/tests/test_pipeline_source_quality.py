from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.core import Evidence
from frontier_review_safe.evidence_resolution import SourceQualityProfile
from frontier_review_safe.evaluation import DecisionProvenanceLedger
from frontier_review_safe.governance import (
    AuthorizationRequest,
    GovernedPermissionGraph,
    Instruction,
    PolicyRule,
    Principal,
)
from frontier_review_safe.orchestration import (
    CostLatencyQualityRouter,
    ProviderState,
    SpecialistContract,
    SpecialistResult,
    SpecialistSociety,
)
from frontier_review_safe.pipeline import ReviewSafeWorkflow, WorkflowAdapters, WorkflowRequest
from frontier_review_safe.verification import VerificationPath

NOW = datetime(2026, 9, 11, 3, 15, tzinfo=timezone.utc).isoformat()
H = "a" * 64


class PipelineSourceQualityTests(unittest.TestCase):
    def test_poor_calibrated_source_profile_can_trigger_fail_closed_abstention(self):
        principal = Principal("u", "tenant", frozenset({"analyst"}), frozenset({"research"}), "ZW")
        permissions = GovernedPermissionGraph([
            PolicyRule("allow", "p1", "ALLOW", frozenset({"research"}), ("research/",), frozenset({"analyst"}))
        ], "p1")
        router = CostLatencyQualityRouter([ProviderState("private", .95, .9, .99, 5, 0, True)])
        specialists = SpecialistSociety({
            "risk": lambda task: SpecialistResult("risk", "lane-risk", "ok", .9, ("e1",))
        })
        verifiers = (
            VerificationPath("local", "invariant", None, lambda r: r["value"] == 42),
            VerificationPath("tool", "alternate", "independent-tool", lambda r: r["value"] == 42,
                             origin="tool:independent", provenance_hash=H),
        )
        flow = ReviewSafeWorkflow(
            permissions=permissions,
            jurisdictions=object(),
            router=router,
            specialists=specialists,
            specialist_contracts=(SpecialistContract("risk", "risk", "lane-risk", .2, 0, 1),),
            verifier_paths=verifiers,
            ledger=DecisionProvenanceLedger(),
        )
        req = WorkflowRequest(
            "req-source-quality", "q", "research", "risk", principal,
            AuthorizationRequest("research", "research/report", "tenant", frozenset({"research"}), frozenset({"analyst"})),
            Instruction("i", "analyze", "user", "user", "research", False),
            NOW, .8, .8, .3, "p1", "candidate", False,
        )
        evidence = Evidence(
            "e1", "fact", True, "source-low-history", NOW, .95, True, .9, .9, 1.0, 1.0, 0.0, 0.0, "g1"
        )
        adapters = WorkflowAdapters(
            lambda r: [evidence],
            lambda r, e, d: {
                "value": 42,
                "confidence": .9,
                "uncertainty": .1,
                "contradiction_status": "RESOLVED",
                "stale_data": False,
                "causal_supported": True,
                "evaluation_boundary_exceeded": False,
                "method": "test",
                "assumptions": ["test"],
            },
            source_profiles={
                "source-low-history": SourceQualityProfile(
                    "source-low-history",
                    domain_expertise=.1,
                    historical_calibration=.1,
                    correction_history_risk=.9,
                )
            },
        )
        result = flow.execute(req, adapters)
        self.assertEqual(result["status"], "ABSTAIN")
        self.assertIn("insufficient_evidence", result["reasons"])
        self.assertEqual(len(result["decision_event_hash"]), 64)


if __name__ == "__main__":
    unittest.main(verbosity=2)
