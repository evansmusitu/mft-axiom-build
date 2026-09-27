from __future__ import annotations

import unittest

from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric, CircuitBreakerPolicy
from frontier_v5.runtime.provider_fallback import ProviderDescriptor, ProviderRequest, ProviderResponse
from multiplatform.orchestrator import (
    AxiomFrontierOrchestrator,
    ProviderBinding,
    load_cases,
)


class FixtureProvider:
    def __init__(self, provider_id: str, output: str, quality: float, *, verified: bool = True, fail: bool = False):
        self.provider_id = provider_id
        self.output = output
        self.quality = quality
        self.fail = fail
        self.descriptor = ProviderDescriptor(
            provider_id=provider_id,
            domains=frozenset({"*"}),
            modalities=frozenset({"text"}),
            required_scopes=frozenset(),
            allowed_jurisdictions=frozenset({"*"}),
            policy_tags=frozenset({"successful_execution"}),
            advertised_quality=quality,
            advertised_latency_ms=1000,
            advertised_cost_units=1.0,
            verified=verified,
        )

    def invoke(self, invocation):
        from multiplatform.providers.contracts import InvocationResult
        if self.fail:
            return InvocationResult(
                provider=self.provider_id,
                case_id=invocation.case_id,
                status="error",
                output={"error": "fixture failure"},
                error_class="FIXTURE_FAILURE",
                latency_ms=5,
            )
        return InvocationResult(
            provider=self.provider_id,
            case_id=invocation.case_id,
            status="ok",
            output=self.output,
            latency_ms=5,
            usage={"total_tokens": 10},
        )


def breakers(*provider_ids: str) -> CircuitBreakerFabric:
    policy = CircuitBreakerPolicy(
        failure_threshold=2,
        failure_window_seconds=60,
        open_seconds=30,
        probe_lease_seconds=10,
        recovery_successes=1,
        timeout_penalty=10,
        error_penalty=20,
        success_reward=5,
        minimum_health_score=20,
    )
    return CircuitBreakerFabric({provider_id: policy for provider_id in provider_ids})


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.cases = load_cases("multiplatform/cases/cases.jsonl")
        self.case = next(case for case in self.cases if case["case_id"] == "Q01")

    def test_axiom_orchestrates_preferred_provider_and_emits_trace(self):
        providers = {
            "openai": ProviderBinding(FixtureProvider("openai", "372", 1.0)),
            "anthropic": ProviderBinding(FixtureProvider("anthropic", "0", 0.2)),
        }
        orchestrator = AxiomFrontierOrchestrator(providers, breakers("openai", "anthropic"))
        report = orchestrator.run_case(
            self.case,
            preferred_provider="openai",
            min_quality=0.8,
        )

        self.assertEqual(report["orchestrator"], "MUSITU_AXIOM")
        self.assertEqual(report["status"], "accepted")
        self.assertEqual(report["provider"], "openai")
        self.assertTrue(report["passed"])
        self.assertEqual(report["attempts"][0]["outcome"], "accepted")
        self.assertEqual(len(report["evidence_sha256"]), 64)
        self.assertEqual(report["routing_feedback"]["accepted_provider"], "openai")

    def test_quality_failure_falls_back_without_lowering_the_floor(self):
        providers = {
            "openai": ProviderBinding(FixtureProvider("openai", "0", 0.2)),
            "anthropic": ProviderBinding(FixtureProvider("anthropic", "372", 1.0)),
        }
        orchestrator = AxiomFrontierOrchestrator(providers, breakers("openai", "anthropic"))
        report = orchestrator.run_case(
            self.case,
            preferred_provider="openai",
            min_quality=0.8,
        )

        self.assertEqual(report["status"], "accepted")
        self.assertEqual(report["provider"], "anthropic")
        self.assertEqual(report["mode"], "degraded")
        self.assertEqual(report["attempts"][0]["outcome"], "quality_below_floor")
        self.assertEqual(report["attempts"][1]["outcome"], "accepted")
        self.assertEqual(report["routing_feedback"]["min_quality_preserved"], 0.8)
        self.assertTrue(report["routing_feedback"]["regret_signal"])

    def test_unverified_provider_is_denied_before_execution(self):
        fixture = FixtureProvider("openai", "372", 1.0, verified=False)
        providers = {
            "openai": ProviderBinding(fixture),
            "anthropic": ProviderBinding(FixtureProvider("anthropic", "372", 1.0)),
        }
        providers["anthropic"] = ProviderBinding(
            FixtureProvider("anthropic", "372", 1.0, verified=False)
        )
        orchestrator = AxiomFrontierOrchestrator(providers, breakers("openai", "anthropic"))

        report = orchestrator.run_case(self.case, preferred_provider="openai")

        self.assertEqual(report["status"], "blocked")
        self.assertIsNone(report["provider"])
        self.assertEqual(report["passed"], False)
        self.assertIn("openai:ineligible_policy", report["error"])
        self.assertIn("anthropic:ineligible_policy", report["error"])

    def test_production_endpoint_cannot_enter_orchestration_fixture(self):
        from multiplatform.providers.axiom import AxiomFrontierAdapter

        with self.assertRaisesRegex(RuntimeError, "PRODUCTION_ENDPOINT_FORBIDDEN"):
            AxiomFrontierAdapter("https://mcp.mftintelligence.com/mcp")


if __name__ == "__main__":
    unittest.main()
