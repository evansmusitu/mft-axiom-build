from __future__ import annotations

import unittest

from frontier_review_safe.orchestration import SpecialistContract, SpecialistResult, SpecialistSociety
from frontier_review_safe.specialist_governance import GovernedSpecialistDeliberation, SpecialistGovernancePolicy


class SpecialistGovernanceTests(unittest.TestCase):
    def policy(self, **overrides):
        values = {
            "minimum_successful_lanes": 2,
            "minimum_consensus_fraction": .67,
            "minimum_mean_confidence": .5,
            "maximum_confidence_spread": .5,
            "maximum_failure_fraction": 0.0,
            "minimum_evidence_ids_per_result": 1,
            "require_unique_specialists": True,
            "require_unique_lanes": True,
            "require_domain_match": True,
            "require_evidence_binding": True,
            "reserve_retry_budget": True,
            "require_minority_dissent": True,
        }
        values.update(overrides)
        return SpecialistGovernancePolicy(**values)

    def task(self):
        return {
            "request": "assess risk",
            "domain": "risk",
            "evidence": [{"evidence_id": "e1"}, {"evidence_id": "e2"}],
        }

    def test_consensus_is_evidence_bound_and_trace_is_reproducible(self):
        handlers = {
            "a": lambda task: SpecialistResult("a", "lane-a", {"decision": "hold"}, .9, ("e1",)),
            "b": lambda task: SpecialistResult("b", "lane-b", {"decision": "hold"}, .8, ("e2",)),
            "c": lambda task: SpecialistResult("c", "lane-c", {"decision": "sell"}, .7, ("e2",), dissent="tail risk"),
        }
        society = SpecialistSociety(handlers)
        contracts = (
            SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
            SpecialistContract("b", "risk", "lane-b", .2, 0, 1),
            SpecialistContract("c", "risk", "lane-c", .2, 0, 1),
        )
        result = GovernedSpecialistDeliberation.deliberate(society, contracts, self.task(), 3, self.policy())
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["governance_status"], "PASS")
        self.assertAlmostEqual(result["consensus_fraction"], 2 / 3)
        self.assertEqual(result["minority_specialists"], ["c"])
        self.assertEqual(set(result["confidence_deltas"]), {"a", "b", "c"})
        self.assertEqual(len(result["governed_trace_sha256"]), 64)

        reversed_result = GovernedSpecialistDeliberation.deliberate(
            society, tuple(reversed(contracts)), self.task(), 3, self.policy()
        )
        self.assertEqual(result["governed_trace_sha256"], reversed_result["governed_trace_sha256"])

    def test_retry_capacity_must_be_reserved_for_consequential_work(self):
        handlers = {
            "a": lambda task: SpecialistResult("a", "lane-a", "same", .9, ("e1",)),
            "b": lambda task: SpecialistResult("b", "lane-b", "same", .9, ("e2",)),
        }
        contracts = (
            SpecialistContract("a", "risk", "lane-a", .2, 1, 1),
            SpecialistContract("b", "risk", "lane-b", .2, 1, 1),
        )
        result = GovernedSpecialistDeliberation.deliberate(
            SpecialistSociety(handlers), contracts, self.task(), 2, self.policy()
        )
        self.assertEqual(result["status"], "VETO")
        self.assertEqual(result["reason"], "specialist_retry_budget_not_reserved")
        self.assertEqual(result["reserved_budget_units"], 4.0)

    def test_duplicate_identity_lane_and_domain_mismatch_fail_closed(self):
        society = SpecialistSociety({"a": lambda task: SpecialistResult("a", "lane-a", "x", .9, ("e1",))})
        duplicate_names = (
            SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
            SpecialistContract("a", "risk", "lane-b", .2, 0, 1),
        )
        self.assertEqual(
            GovernedSpecialistDeliberation.deliberate(society, duplicate_names, self.task(), 2, self.policy())["reason"],
            "duplicate_specialist_identity",
        )
        duplicate_lanes = (
            SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
            SpecialistContract("b", "risk", "lane-a", .2, 0, 1),
        )
        self.assertEqual(
            GovernedSpecialistDeliberation.deliberate(society, duplicate_lanes, self.task(), 2, self.policy())["reason"],
            "duplicate_specialist_lane",
        )
        wrong_domain = (
            SpecialistContract("a", "macro", "lane-a", .2, 0, 1),
            SpecialistContract("b", "macro", "lane-b", .2, 0, 1),
        )
        self.assertEqual(
            GovernedSpecialistDeliberation.deliberate(society, wrong_domain, self.task(), 2, self.policy())["reason"],
            "specialist_domain_mismatch",
        )

    def test_unbound_or_missing_evidence_fails_closed(self):
        handlers = {
            "a": lambda task: SpecialistResult("a", "lane-a", "same", .9, ("invented",)),
            "b": lambda task: SpecialistResult("b", "lane-b", "same", .9, ("e2",)),
        }
        contracts = (
            SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
            SpecialistContract("b", "risk", "lane-b", .2, 0, 1),
        )
        result = GovernedSpecialistDeliberation.deliberate(
            SpecialistSociety(handlers), contracts, self.task(), 2, self.policy()
        )
        self.assertEqual(result["status"], "VETO")
        self.assertEqual(result["reason"], "specialist_unbound_evidence")

    def test_split_vote_deadlocks_instead_of_average_confidence_laundering(self):
        handlers = {
            "a": lambda task: SpecialistResult("a", "lane-a", "buy", .99, ("e1",), dissent="sell case considered"),
            "b": lambda task: SpecialistResult("b", "lane-b", "sell", .99, ("e2",), dissent="buy case considered"),
        }
        contracts = (
            SpecialistContract("a", "risk", "lane-a", .2, 0, 1),
            SpecialistContract("b", "risk", "lane-b", .2, 0, 1),
        )
        result = GovernedSpecialistDeliberation.deliberate(
            SpecialistSociety(handlers), contracts, self.task(), 2,
            self.policy(minimum_consensus_fraction=.75),
        )
        self.assertEqual(result["status"], "VETO")
        self.assertEqual(result["reason"], "specialist_deadlock")
        self.assertEqual(result["consensus_fraction"], .5)

    def test_minority_without_explicit_dissent_is_rejected(self):
        handlers = {
            "a": lambda task: SpecialistResult("a", "lane-a", "hold", .9, ("e1",)),
            "b": lambda task: SpecialistResult("b", "lane-b", "hold", .9, ("e1",)),
            "c": lambda task: SpecialistResult("c", "lane-c", "sell", .9, ("e2",)),
        }
        contracts = tuple(
            SpecialistContract(name, "risk", f"lane-{name}", .2, 0, 1)
            for name in ("a", "b", "c")
        )
        result = GovernedSpecialistDeliberation.deliberate(
            SpecialistSociety(handlers), contracts, self.task(), 3, self.policy()
        )
        self.assertEqual(result["status"], "VETO")
        self.assertEqual(result["reason"], "minority_dissent_not_recorded")


if __name__ == "__main__":
    unittest.main(verbosity=2)
