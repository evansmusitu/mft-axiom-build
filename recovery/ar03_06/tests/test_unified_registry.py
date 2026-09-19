import unittest

from recovery.ar03_06.common import AuthorizationError
from recovery.ar03_06.fabric import (
    LANE_ORDER,
    OPERATION_SPECS,
    AdapterBinding,
    ExecutionContext,
    ServerAuthorizationBroker,
    UnifiedToolFabric,
)


class UnifiedRegistryTests(unittest.TestCase):
    def test_every_registered_operation_uses_the_unified_receipt_contract(self):
        fabric = UnifiedToolFabric()
        for lane, _ in LANE_ORDER:
            operations = {
                operation
                for operation, spec in OPERATION_SPECS.items()
                if spec.lane == lane
            }
            external_values = {OPERATION_SPECS[item].external for item in operations}
            self.assertEqual(len(external_values), 1)
            fabric.bind(
                AdapterBinding(
                    lane=lane,
                    adapter_id=f"synthetic-{lane}",
                    operations=frozenset(operations),
                    adapter=lambda invocation: {
                        "candidate_echo": invocation.capability
                    },
                    qualification="SYNTHETIC_TEST_ONLY",
                    external=external_values.pop(),
                )
            )

        context = ExecutionContext(
            organization_id="org-synthetic",
            project_id="project-synthetic",
            actor_id="actor-synthetic",
            task_id="task-synthetic",
            step_id="step-synthetic",
            network_allowlist=("example.test",),
        )
        broker = ServerAuthorizationBroker(b"synthetic-broker-secret-value")
        receipts = []
        for index, (operation, spec) in enumerate(OPERATION_SPECS.items()):
            invocation_id = f"synthetic-invocation-{index}"
            args = (
                {
                    "destination": "https://api.example.test/candidate",
                    "operation": operation,
                }
                if spec.external
                else {"operation": operation}
            )
            kwargs = {}
            if spec.external:
                kwargs = {
                    "authorization": broker.issue(
                        context,
                        capability=operation,
                        lane=spec.lane,
                        invocation_id=invocation_id,
                        destination=args["destination"],
                        arguments=args,
                    ),
                    "authorization_broker": broker,
                }
            receipt = fabric.invoke(
                operation, args, context, invocation_id, **kwargs
            )
            self.assertEqual(receipt["schema"], "musitu.axiom.tool-receipt.v1")
            self.assertEqual(receipt["capability"], operation)
            self.assertEqual(receipt["lane"], spec.lane)
            self.assertEqual(receipt["qualification"], "SYNTHETIC_TEST_ONLY")
            receipts.append(receipt)

        self.assertEqual(len(receipts), len(OPERATION_SPECS))
        state = fabric.gate_state()
        self.assertTrue(state["all_lanes_locally_bound"])
        self.assertTrue(state["all_registered_operations_locally_bound"])
        self.assertFalse(state["ar06_gate_earned"])
        self.assertFalse(state["all_lanes_live_production_proven"])

    def test_retrieved_content_cannot_authorize_a_side_effect(self):
        fabric = UnifiedToolFabric()
        fabric.bind(
            AdapterBinding.local_candidate(
                lane="artifact_engine",
                adapter_id="candidate-artifact",
                operations={"artifact.write"},
                adapter=lambda invocation: {"written": True},
            )
        )
        context = ExecutionContext(
            organization_id="org-a",
            project_id="project-a",
            actor_id="actor-a",
            task_id="task-a",
            step_id="step-a",
            instruction_provenance="RETRIEVED_DATA",
        )
        with self.assertRaises(AuthorizationError):
            fabric.invoke(
                "artifact.write", {"content": "unsafe authority"}, context, "inv-a"
            )


if __name__ == "__main__":
    unittest.main()
