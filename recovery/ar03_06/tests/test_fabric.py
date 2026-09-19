import dataclasses
import unittest

from recovery.ar03_06.common import AuthorizationError, IntegrityError
from recovery.ar03_06.fabric import (
    ATOMIC_OPERATIONS,
    LANE_ORDER,
    AdapterBinding,
    ExecutionContext,
    ServerAuthorizationBroker,
    UnifiedToolFabric,
)


class UnifiedFabricContractTests(unittest.TestCase):
    def setUp(self):
        self.fabric = UnifiedToolFabric()
        self.context = ExecutionContext(
            organization_id="org-a",
            project_id="project-a",
            actor_id="user-a",
            task_id="task-a",
            step_id="step-a",
            instruction_provenance="GOVERNED_PLAN",
            network_allowlist=("example.test",),
        )

    def test_exact_registry_order_and_unbound_fail_closed(self):
        self.assertEqual(len(ATOMIC_OPERATIONS), 74)
        self.assertEqual(len(set(ATOMIC_OPERATIONS)), 74)
        self.assertEqual([order for _, order in LANE_ORDER], list(range(1, 11)))
        with self.assertRaises(AuthorizationError):
            self.fabric.invoke("arithmetic.evaluate", {"expression": "40+2"}, self.context, "inv-1")
        state = self.fabric.gate_state()
        self.assertFalse(state["ar06_gate_earned"])
        self.assertEqual(state["superiority"], "NOT_CERTIFIED")

    def test_every_invocation_uses_one_receipt_path_and_builder_cannot_self_certify(self):
        with self.assertRaises(AuthorizationError):
            AdapterBinding(
                lane="quantitative",
                adapter_id="bad",
                operations=frozenset({"arithmetic.evaluate"}),
                adapter=lambda invocation: {"result": 42},
                qualification="PRODUCTION_PROVEN",
            )
        self.fabric.bind(AdapterBinding.local_candidate(
            lane="quantitative",
            adapter_id="safe-math",
            operations={"arithmetic.evaluate"},
            adapter=lambda invocation: {"result": 42},
        ))
        receipt = self.fabric.invoke("arithmetic.evaluate", {"expression": "40+2"}, self.context, "inv-2")
        self.assertEqual(receipt["schema"], "musitu.axiom.tool-receipt.v1")
        self.assertEqual(receipt["lane"], "quantitative")
        self.assertEqual(len(receipt["receipt_sha256"]), 64)
        self.assertFalse(self.fabric.gate_state()["ar06_gate_earned"])

    def test_external_lane_requires_exact_server_signed_authorization(self):
        self.fabric.bind(AdapterBinding.local_candidate(
            lane="research_source",
            adapter_id="read-only-research",
            operations={"research.search"},
            adapter=lambda invocation: {"source_count": 1},
            external=True,
        ))
        with self.assertRaises(AuthorizationError):
            self.fabric.invoke(
                "research.search",
                {"query": "safe", "destination": "https://api.example.test/search"},
                self.context,
                "inv-3",
            )
        broker = ServerAuthorizationBroker(b"authorization-broker-test-key")
        grant = broker.issue(
            self.context,
            capability="research.search",
            lane="research_source",
            invocation_id="inv-3",
            destination="https://api.example.test/search",
            arguments={"query": "safe", "destination": "https://api.example.test/search"},
        )
        receipt = self.fabric.invoke(
            "research.search",
            {"query": "safe", "destination": "https://api.example.test/search"},
            self.context,
            "inv-3",
            authorization=grant,
            authorization_broker=broker,
        )
        self.assertEqual(receipt["result"]["source_count"], 1)
        tampered = dataclasses.replace(grant, destination="https://evil.example/")
        with self.assertRaises(IntegrityError):
            self.fabric.invoke(
                "research.search",
                {"query": "safe", "destination": "https://evil.example/"},
                self.context,
                "inv-3",
                authorization=tampered,
                authorization_broker=broker,
            )


if __name__ == "__main__":
    unittest.main()
