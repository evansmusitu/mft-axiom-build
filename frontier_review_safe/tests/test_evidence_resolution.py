from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.core import Evidence
from frontier_review_safe.evidence_resolution import (
    ContradictionResolver,
    ResearchSourceScorer,
    SourceQualityProfile,
)

NOW = datetime(2026, 9, 11, 3, 0, tzinfo=timezone.utc).isoformat()


def ev(eid: str, value, source: str, group: str | None = None, **kw):
    return Evidence(
        evidence_id=eid,
        claim="claim-x",
        value=value,
        source_id=source,
        observed_at=NOW,
        confidence=kw.pop("confidence", .9),
        primary=kw.pop("primary", True),
        authority=kw.pop("authority", .85),
        methodological_rigor=kw.pop("methodological_rigor", .85),
        provenance_integrity=kw.pop("provenance_integrity", 1.0),
        recency_score=kw.pop("recency_score", 1.0),
        correction_risk=kw.pop("correction_risk", 0.0),
        conflict_risk=kw.pop("conflict_risk", 0.0),
        independence_group=group,
        **kw,
    )


class EvidenceResolutionTests(unittest.TestCase):
    def test_one_dependency_group_cannot_support_both_sides(self):
        items = [
            ev("syn-yes", "YES", "wire-a", "syndicated"),
            ev("syn-no", "NO", "wire-b", "syndicated"),
            ev("ind-yes", "YES", "primary-independent", "independent-a"),
        ]
        result = ContradictionResolver.resolve(items)
        self.assertEqual(result["status"], "RESOLVED")
        self.assertEqual(result["value"], "YES")
        self.assertEqual(result["internally_conflicted_component_count"], 1)
        self.assertEqual(result["evidence_ids"], ["ind-yes"])
        conflicted_ids = result["internally_conflicted_components"][0]["evidence_ids"]
        self.assertEqual(conflicted_ids, ["syn-no", "syn-yes"])

    def test_all_internally_conflicted_support_fails_closed(self):
        result = ContradictionResolver.resolve([
            ev("a", 1, "source-a", "same-family"),
            ev("b", 2, "source-b", "same-family"),
        ])
        self.assertEqual(result["status"], "UNRESOLVED")
        self.assertEqual(result["reasons"], ["all_support_internally_conflicted"])
        self.assertEqual(result["usable_component_count"], 0)

    def test_dependency_is_transitive_across_source_and_group_links(self):
        result = ContradictionResolver.resolve([
            ev("a1", "UP", "source-a", "group-1"),
            ev("a2", "UP", "source-a", "group-2"),
            ev("b1", "DOWN", "source-b", "group-2"),
            ev("c1", "UP", "source-c", "group-3"),
        ])
        self.assertEqual(result["status"], "RESOLVED")
        self.assertEqual(result["value"], "UP")
        self.assertEqual(result["dependency_component_count"], 2)
        self.assertEqual(result["internally_conflicted_component_count"], 1)
        self.assertEqual(result["evidence_ids"], ["c1"])

    def test_correlated_duplicates_count_once_and_are_reported(self):
        items = [
            ev("a1", "YES", "source-a", "family"),
            ev("a2", "YES", "source-b", "family", authority=.7),
            ev("b1", "NO", "source-c", "other", authority=.55, methodological_rigor=.55),
        ]
        result = ContradictionResolver.resolve(items, minimum_margin=.01)
        self.assertGreaterEqual(result["discarded_correlated_items"], 1)
        self.assertEqual(len(result["supporting_component_ids"]), 1)

    def test_minimum_independent_component_requirement_can_force_abstention(self):
        result = ContradictionResolver.resolve([
            ev("a", "YES", "source-a", "a"),
            ev("b", "NO", "source-b", "b", authority=.4, methodological_rigor=.4),
        ], minimum_independent_components=2)
        self.assertEqual(result["status"], "UNRESOLVED")
        self.assertIn("insufficient_independent_components", result["reasons"])

    def test_source_profile_changes_quality_without_faking_independence(self):
        evidence = ev("e", "YES", "specialist-source", "group")
        weak = SourceQualityProfile("specialist-source", domain_expertise=.1, historical_calibration=.1, correction_history_risk=.8)
        strong = SourceQualityProfile("specialist-source", domain_expertise=.95, historical_calibration=.95, correction_history_risk=0.0)
        self.assertGreater(
            ResearchSourceScorer.score(evidence, strong),
            ResearchSourceScorer.score(evidence, weak),
        )
        with self.assertRaises(ValueError):
            ResearchSourceScorer.score(evidence, SourceQualityProfile("other-source"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
