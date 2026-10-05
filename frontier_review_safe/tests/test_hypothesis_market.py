from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.core import Evidence, FrontierSafetyError
from frontier_review_safe.hypothesis_market import HypothesisDefinition, HypothesisMarket, HypothesisState

NOW = datetime(2026, 9, 11, 7, 0, tzinfo=timezone.utc).isoformat()
H = "a" * 64


def ev(eid: str, *, group: str, source: str | None = None) -> Evidence:
    return Evidence(
        evidence_id=eid,
        claim="market-state",
        value=True,
        source_id=source or eid,
        observed_at=NOW,
        confidence=.9,
        primary=True,
        authority=.9,
        methodological_rigor=.9,
        provenance_integrity=1.0,
        recency_score=1.0,
        independence_group=group,
    )


class HypothesisMarketTests(unittest.TestCase):
    def test_backward_compatible_single_step_update_remains_available(self):
        state = HypothesisState("h", "statement", .5, "OPEN", (), NOW, "audited resolution")
        updated = HypothesisMarket.update(state, ev("e1", group="g1"), .8, .2)
        self.assertAlmostEqual(updated.probability, .8)
        self.assertEqual(updated.evidence_ids, ("e1",))

    def test_dependent_evidence_group_cannot_be_counted_twice(self):
        market = HypothesisMarket()
        market.register(HypothesisDefinition("h", "statement", .5, "criteria", NOW))
        market.apply_evidence("h", ev("e1", group="wire"), .8, .2)
        with self.assertRaises(FrontierSafetyError):
            market.apply_evidence("h", ev("e2", group="wire"), .8, .2)

    def test_specialist_disagreement_blocks_resolution_until_adjudicated(self):
        market = HypothesisMarket()
        market.register(HypothesisDefinition("h", "statement", .5, "criteria", NOW))
        first = market.apply_evidence(
            "h", ev("e1", group="g1"), .9, .1,
            specialist_probabilities={"bull": .95, "bear": .20},
            max_specialist_spread=.3,
        )
        self.assertEqual(first["status"], "DISPUTED")
        market.apply_evidence("h", ev("e2", group="g2"), .9, .1)
        with self.assertRaises(FrontierSafetyError):
            market.resolve(
                "h", True, resolver_id="resolver", criteria_satisfied=True,
                criteria_evidence_hash=H, minimum_independent_groups=2,
            )
        market.resolve_disagreement(
            "h", first["update_id"], reviewer_id="reviewer", rationale_hash=H
        )
        event = market.resolve(
            "h", True, resolver_id="resolver", criteria_satisfied=True,
            criteria_evidence_hash=H, minimum_independent_groups=2,
        )
        self.assertEqual(len(event), 64)
        self.assertEqual(market.state("h").status, "RESOLVED_TRUE")

    def test_mutually_exclusive_competitors_cannot_both_resolve_true(self):
        market = HypothesisMarket()
        market.register(HypothesisDefinition("a", "A", .5, "criteria-a", NOW, ("b",)))
        market.register(HypothesisDefinition("b", "B", .5, "criteria-b", NOW, ("a",)))
        self.assertTrue(market.validate_competitor_graph())
        for hid in ("a", "b"):
            market.apply_evidence(hid, ev(f"{hid}1", group=f"{hid}-g1"), .9, .1)
            market.apply_evidence(hid, ev(f"{hid}2", group=f"{hid}-g2"), .9, .1)
        market.resolve(
            "a", True, resolver_id="r", criteria_satisfied=True,
            criteria_evidence_hash=H, minimum_independent_groups=2,
        )
        with self.assertRaises(FrontierSafetyError):
            market.resolve(
                "b", True, resolver_id="r", criteria_satisfied=True,
                criteria_evidence_hash=H, minimum_independent_groups=2,
            )

    def test_persistence_is_replayable_and_tamper_evident(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "market.json"
            market = HypothesisMarket(path)
            market.register(HypothesisDefinition("h", "statement", .5, "criteria", NOW))
            market.apply_evidence("h", ev("e1", group="g1"), .8, .2)
            fingerprint = market.fingerprint
            loaded = HypothesisMarket(path)
            self.assertEqual(loaded.fingerprint, fingerprint)
            raw = path.read_text(encoding="utf-8")
            path.write_text(raw.replace('"posterior_probability":0.8', '"posterior_probability":0.9'), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                HypothesisMarket(path)

    def test_calibration_is_measured_from_resolved_probability_and_outcome(self):
        market = HypothesisMarket()
        market.register(HypothesisDefinition("h", "statement", .5, "criteria", NOW))
        market.apply_evidence("h", ev("e1", group="g1"), .9, .1)
        market.apply_evidence("h", ev("e2", group="g2"), .9, .1)
        market.resolve(
            "h", True, resolver_id="r", criteria_satisfied=True,
            criteria_evidence_hash=H, minimum_independent_groups=2,
        )
        report = market.calibration_report(minimum_resolved=1)
        self.assertEqual(report["status"], "MEASURED")
        self.assertEqual(report["resolved_count"], 1)
        self.assertLess(report["brier"], .01)
        self.assertEqual(len(report["evidence_sha256"]), 64)


if __name__ == "__main__":
    unittest.main(verbosity=2)
