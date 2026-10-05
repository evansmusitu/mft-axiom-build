from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
from frontier_review_safe.orchestration import (
    CostLatencyQualityRouter,
    ProviderState,
    SpecialistContract,
    SpecialistResult,
    SpecialistSociety,
)
from frontier_review_safe.pipeline import ReviewSafeWorkflow, WorkflowAdapters, WorkflowRequest


NOW = datetime(2026, 9, 11, 6, 0, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()


class PipelineSpecialistGovernanceTests(unittest.TestCase):
    def test_high_consequence_deadlock_abstains_before_analysis_and_is_ledgered(self):
        principal = Principal(
            "analyst-1", "tenant-1", frozenset({"analyst"}), frozenset({"research"}), "ZW"
        )
        permissions = GovernedPermissionGraph(
            [
                PolicyRule(
                    "allow-research", "p1", "ALLOW", frozenset({"research"}),
                    ("research/",), frozenset({"analyst"}), frozenset({"ZW"}),
                )
            ],
            "p1",
        )
        jurisdictions = PolicyJurisdictionRouter(
            [
                JurisdictionPolicy(
                    "ZW", "j1", (NOW - timedelta(days=1)).isoformat(),
                    (NOW + timedelta(days=1)).isoformat(), "gazette:test", frozenset({"research"}),
                )
            ]
        )
        router = CostLatencyQualityRouter([ProviderState("private-route", .95, .95, .99, 10, .1, True)])
        specialists = SpecialistSociety(
            {
                "bull": lambda task: SpecialistResult(
                    "bull", "lane-bull", "BUY", .95, ("e1",), dissent="bear evidence considered"
                ),
                "bear": lambda task: SpecialistResult(
                    "bear", "lane-bear", "SELL", .95, ("e2",), dissent="bull evidence considered"
                ),
            }
        )
        contracts = (
            SpecialistContract("bull", "risk", "lane-bull", .2, 0, 1),
            SpecialistContract("bear", "risk", "lane-bear", .2, 0, 1),
        )
        ledger = DecisionProvenanceLedger()
        workflow = ReviewSafeWorkflow(
            permissions=permissions,
            jurisdictions=jurisdictions,
            router=router,
            specialists=specialists,
            specialist_contracts=contracts,
            verifier_paths=(),
            ledger=ledger,
        )
        request = WorkflowRequest(
            "deadlock-request",
            "should the position be changed?",
            "research",
            "risk",
            principal,
            AuthorizationRequest(
                "research", "research/risk-report", "tenant-1",
                frozenset({"research"}), frozenset({"analyst"}), jurisdiction="ZW", consequential=True,
            ),
            Instruction("instruction-1", "assess the risk", "user", "user", "research", True),
            NOW_S,
            .4,
            .8,
            .3,
            "p1",
            "candidate-sha",
            True,
        )
        evidence = [
            Evidence("e1", "risk_signal", "BUY", "source-a", NOW_S, .95, True, .9, .9, 1, 1),
            Evidence("e2", "risk_signal", "SELL", "source-b", NOW_S, .95, True, .9, .9, 1, 1),
        ]
        called = {"analysis": False}

        def analyze(*args):
            called["analysis"] = True
            return {"confidence": .99, "uncertainty": .01}

        result = workflow.execute(
            request,
            WorkflowAdapters(lambda req: evidence, analyze),
            specialist_budget=2,
        )
        self.assertEqual(result["status"], "ABSTAIN")
        self.assertEqual(result["reasons"], ["specialist_deadlock"])
        self.assertFalse(called["analysis"])
        self.assertEqual(len(ledger.events), 1)
        self.assertEqual(ledger.events[0]["event_type"], "analysis.abstain")
        self.assertEqual(ledger.events[0]["payload"]["reasons"], ["specialist_deadlock"])
        self.assertTrue(ledger.verify())


if __name__ == "__main__":
    unittest.main(verbosity=2)
