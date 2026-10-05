from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.core import AuthorizationDenied
from frontier_review_safe.governance import (
    AuthorizationRequest,
    DelegationGrant,
    GovernedPermissionGraph,
    PolicyRule,
    Principal,
)

BASE = datetime(2026, 9, 11, 4, 0, tzinfo=timezone.utc)


class GovernedPermissionDeepTests(unittest.TestCase):
    def test_resource_prefix_matching_is_segment_safe(self):
        graph = GovernedPermissionGraph([
            PolicyRule("allow-public", "p1", "ALLOW", frozenset({"read"}), ("portfolio/public",), frozenset({"analyst"}))
        ], "p1")
        principal = Principal("u", "t", frozenset({"analyst"}), frozenset(), "ZW")
        allowed = AuthorizationRequest("read", "portfolio/public/item", "t")
        self.assertTrue(graph.authorize(principal, allowed)["authorized"])
        with self.assertRaises(AuthorizationDenied):
            graph.authorize(principal, AuthorizationRequest("read", "portfolio/publicity", "t"))

    def test_ambiguous_or_traversal_resources_are_rejected_before_policy_evaluation(self):
        for resource in ("research/../secret", "research//secret", "/absolute", "research\\secret"):
            with self.subTest(resource=resource), self.assertRaises(ValueError):
                AuthorizationRequest("read", resource, "t")

    def _delegated_graph(self):
        parent = DelegationGrant(
            "g-parent", "p1", "root-user", "service-a", "t",
            frozenset({"research.read"}), frozenset({"read"}), ("research/",),
            BASE.isoformat(), (BASE + timedelta(hours=2)).isoformat(), "reporting",
        )
        child = DelegationGrant(
            "g-child", "p1", "service-a", "worker-b", "t",
            frozenset({"research.read"}), frozenset({"read"}), ("research/report",),
            (BASE + timedelta(minutes=5)).isoformat(), (BASE + timedelta(hours=1)).isoformat(),
            "reporting", "g-parent",
        )
        graph = GovernedPermissionGraph([
            PolicyRule("allow-research", "p1", "ALLOW", frozenset({"read"}), ("research/",), frozenset({"analyst"}))
        ], "p1", delegations=(parent, child))
        principal = Principal(
            "worker-b", "t", frozenset({"analyst"}), frozenset({"research.read"}), "ZW",
            delegated_by="service-a", delegation_scopes=frozenset({"research.read"}), delegation_id="g-child",
        )
        return graph, principal

    def test_versioned_delegation_is_time_action_resource_and_purpose_bound(self):
        graph, principal = self._delegated_graph()
        req = AuthorizationRequest(
            "read", "research/report/daily", "t", frozenset({"research.read"}),
            frozenset({"analyst"}), at=(BASE + timedelta(minutes=10)).isoformat(), purpose="reporting",
        )
        result = graph.authorize(principal, req)
        self.assertEqual(result["delegation_chain"], ["g-child", "g-parent"])
        self.assertEqual(len(result["authorization_sha256"]), 64)

        with self.assertRaises(AuthorizationDenied):
            graph.authorize(principal, AuthorizationRequest(
                "read", "research/report/daily", "t", frozenset({"research.read"}),
                at=(BASE + timedelta(hours=1, minutes=1)).isoformat(), purpose="reporting",
            ))
        with self.assertRaises(AuthorizationDenied):
            graph.authorize(principal, AuthorizationRequest(
                "read", "research/other", "t", frozenset({"research.read"}),
                at=(BASE + timedelta(minutes=10)).isoformat(), purpose="reporting",
            ))
        with self.assertRaises(AuthorizationDenied):
            graph.authorize(principal, AuthorizationRequest(
                "read", "research/report/daily", "t", frozenset({"research.read"}),
                at=(BASE + timedelta(minutes=10)).isoformat(), purpose="different-purpose",
            ))

    def test_delegated_request_without_versioned_grant_fails_closed(self):
        graph = GovernedPermissionGraph([
            PolicyRule("allow", "p1", "ALLOW", frozenset({"read"}), ("research/",))
        ], "p1")
        principal = Principal(
            "worker", "t", frozenset(), frozenset({"research.read"}), "ZW",
            delegated_by="service", delegation_scopes=frozenset({"research.read"}),
        )
        with self.assertRaises(AuthorizationDenied):
            graph.authorize(principal, AuthorizationRequest(
                "read", "research/x", "t", frozenset({"research.read"}), at=BASE.isoformat(),
            ))

    def test_delegation_chain_cannot_escalate_scope_action_resource_expiry_or_purpose(self):
        parent = DelegationGrant(
            "parent", "p1", "root", "middle", "t",
            frozenset({"read.scope"}), frozenset({"read"}), ("research/report",),
            BASE.isoformat(), (BASE + timedelta(hours=1)).isoformat(), "purpose-a",
        )
        cases = (
            DelegationGrant("scope", "p1", "middle", "leaf", "t", frozenset({"read.scope", "admin"}), frozenset({"read"}),
                            ("research/report",), BASE.isoformat(), (BASE + timedelta(minutes=30)).isoformat(), "purpose-a", "parent"),
            DelegationGrant("action", "p1", "middle", "leaf", "t", frozenset({"read.scope"}), frozenset({"write"}),
                            ("research/report",), BASE.isoformat(), (BASE + timedelta(minutes=30)).isoformat(), "purpose-a", "parent"),
            DelegationGrant("resource", "p1", "middle", "leaf", "t", frozenset({"read.scope"}), frozenset({"read"}),
                            ("research/",), BASE.isoformat(), (BASE + timedelta(minutes=30)).isoformat(), "purpose-a", "parent"),
            DelegationGrant("expiry", "p1", "middle", "leaf", "t", frozenset({"read.scope"}), frozenset({"read"}),
                            ("research/report",), BASE.isoformat(), (BASE + timedelta(hours=2)).isoformat(), "purpose-a", "parent"),
            DelegationGrant("purpose", "p1", "middle", "leaf", "t", frozenset({"read.scope"}), frozenset({"read"}),
                            ("research/report",), BASE.isoformat(), (BASE + timedelta(minutes=30)).isoformat(), "purpose-b", "parent"),
        )
        rule = PolicyRule("allow", "p1", "ALLOW", frozenset({"read"}), ("research/",))
        for child in cases:
            with self.subTest(child=child.grant_id), self.assertRaises(ValueError):
                GovernedPermissionGraph([rule], "p1", delegations=(parent, child))


if __name__ == "__main__":
    unittest.main(verbosity=2)
