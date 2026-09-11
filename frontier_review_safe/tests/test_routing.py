from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.core import Abstained, FrontierSafetyError
from frontier_review_safe.routing import CostLatencyQualityRouter, ProviderState, RoutingPolicy

NOW = datetime(2026, 9, 11, 7, 30, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
H = "a" * 64


def provider(name: str, quality: float, *, capabilities=frozenset(), jurisdictions=frozenset()) -> ProviderState:
    return ProviderState(name, quality, .95, .99, 20.0, .1, True, capabilities=capabilities, jurisdictions=jurisdictions)


class RoutingTests(unittest.TestCase):
    def test_failures_open_circuit_and_fallback_provider_is_selected(self):
        router = CostLatencyQualityRouter([provider("a", .99), provider("b", .85)])
        self.assertEqual(router.route(NOW_S, .8)["provider"].name, "a")
        for i in range(3):
            router.record_outcome("a", outcome_id=f"fail-{i}", success=False, occurred_at=NOW_S)
        routed = router.route(NOW_S, .8)
        self.assertEqual(routed["provider"].name, "b")
        self.assertEqual(routed["rejection_counts"]["circuit_open"], 1)

    def test_expired_circuit_enters_half_open_and_success_recovers(self):
        router = CostLatencyQualityRouter([provider("a", .99)])
        for i in range(3):
            router.record_outcome("a", outcome_id=f"fail-{i}", success=False, occurred_at=NOW_S)
        later = (NOW + timedelta(seconds=61)).isoformat()
        half = router.route(later, .4)
        self.assertEqual(half["provider"].name, "a")
        self.assertEqual(half["degradation_state"], "HALF_OPEN")
        router.record_outcome("a", outcome_id="recovery", success=True, occurred_at=later, observed_quality=.98)
        recovered = router.route(later, .4)
        self.assertEqual(recovered["degradation_state"], "NORMAL")
        self.assertEqual(router.provider_state("a").consecutive_failures, 0)

    def test_policy_health_capability_and_jurisdiction_constraints_fail_closed(self):
        a = provider("a", .99, capabilities=frozenset({"research"}), jurisdictions=frozenset({"ZW"}))
        b = provider("b", .90, capabilities=frozenset({"research", "code"}), jurisdictions=frozenset({"US"}))
        router = CostLatencyQualityRouter([a, b])
        self.assertEqual(router.route(NOW_S, .8, capability="research", jurisdiction="ZW")["provider"].name, "a")
        router.set_policy_allowed("a", False, policy_version="p1", evidence_hash=H, occurred_at=NOW_S)
        with self.assertRaises(Abstained):
            router.route(NOW_S, .8, capability="research", jurisdiction="ZW")
        router.set_policy_allowed("a", True, policy_version="p2", evidence_hash=H, occurred_at=NOW_S)
        router.set_health("a", False, source_id="health-probe", evidence_hash=H, occurred_at=NOW_S)
        with self.assertRaises(Abstained):
            router.route(NOW_S, .8, capability="research", jurisdiction="ZW")

    def test_outcome_idempotency_conflict_fails_closed(self):
        router = CostLatencyQualityRouter([provider("a", .99)])
        first = router.record_outcome("a", outcome_id="r1", success=True, occurred_at=NOW_S, latency_ms=10)
        self.assertEqual(first, router.record_outcome("a", outcome_id="r1", success=True, occurred_at=NOW_S, latency_ms=10))
        with self.assertRaises(FrontierSafetyError):
            router.record_outcome("a", outcome_id="r1", success=False, occurred_at=NOW_S, latency_ms=10)

    def test_persistent_feedback_replays_and_tamper_is_detected(self):
        providers = [provider("a", .99), provider("b", .85)]
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "routing.json"
            router = CostLatencyQualityRouter(providers, path)
            router.record_outcome("a", outcome_id="f1", success=False, occurred_at=NOW_S)
            fingerprint = router.fingerprint
            loaded = CostLatencyQualityRouter(providers, path)
            self.assertEqual(loaded.fingerprint, fingerprint)
            self.assertEqual(loaded.provider_state("a").consecutive_failures, 1)
            raw = path.read_text(encoding="utf-8")
            path.write_text(raw.replace('"success":false', '"success":true'), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                CostLatencyQualityRouter(providers, path)

    def test_router_returns_ordered_fallbacks_and_selection_fingerprint(self):
        router = CostLatencyQualityRouter([provider("a", .99), provider("b", .90), provider("c", .88)])
        result = router.route(NOW_S, .8)
        self.assertEqual(result["provider"].name, "a")
        self.assertEqual([p.name for p in result["fallbacks"]], ["b", "c"])
        self.assertEqual(len(result["selection_sha256"]), 64)
        self.assertTrue(result["policy_version"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
