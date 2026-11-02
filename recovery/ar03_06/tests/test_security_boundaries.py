import dataclasses
import json
import tempfile
import unittest
from pathlib import Path

from recovery.ar03_06.common import AuthenticationError, AuthorizationError
from recovery.ar03_06.fabric import AdapterBinding
from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class CandidateSecurityBoundaryTests(unittest.TestCase):
    def test_forged_stale_and_under_scoped_identity_contexts_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="axiom-authority-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard(
                "owner@example.test", "LongPasswordOne!2026", "One"
            )
            context = runtime.identity.authenticate(owner["session_token"])
            forged = dataclasses.replace(context, role="admin")
            with self.assertRaises(AuthenticationError):
                runtime.graph.list_entities(forged, owner["project_id"])

            issued = runtime.identity.issue_api_key(
                owner["session_token"], "read-only", ["axiom.project.read"]
            )
            key_context = runtime.identity.authenticate_api_key(issued["secret_once"])
            with self.assertRaises(AuthorizationError):
                runtime.identity.require_entitlement(
                    key_context, "axiom.safe_task.execute"
                )

            recovery = runtime.identity.request_recovery("owner@example.test")
            runtime.identity.complete_recovery(
                recovery["token_once"], "ReplacementPassword!2026"
            )
            with self.assertRaises(AuthenticationError):
                runtime.graph.list_entities(context, owner["project_id"])
            runtime.close()

    def test_step_input_tamper_is_stopped_before_adapter_execution(self):
        with tempfile.TemporaryDirectory(prefix="axiom-step-tamper-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard(
                "owner@example.test", "LongPasswordOne!2026", "One"
            )
            context = runtime.identity.authenticate(owner["session_token"])
            task = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [
                    {
                        "operation": "arithmetic.evaluate",
                        "args": {"expression": "1+1"},
                    }
                ],
                budget_max=2,
                idempotency_key="tamper-before-execute",
            )
            runtime.store.connection.execute(
                "UPDATE task_steps SET args_json=? WHERE task_id=?",
                (json.dumps({"expression": "999+1"}), task["task_id"]),
            )
            runtime.store.connection.commit()
            result = runtime.kernel.run_once(
                context, task["task_id"], "security-worker", runtime.fabric
            )
            self.assertEqual(result["state"], "FAILED")
            receipt_count = runtime.store.connection.execute(
                "SELECT COUNT(*) FROM tool_receipts WHERE task_id=?",
                (task["task_id"],),
            ).fetchone()[0]
            self.assertEqual(receipt_count, 0)
            verdict = runtime.kernel.verify_task(context, task["task_id"])
            self.assertEqual(verdict["status"], "FAIL")
            self.assertIn(
                f"step_input:{task['steps'][0]['step_id']}", verdict["errors"]
            )

            metadata_task = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [
                    {
                        "operation": "arithmetic.evaluate",
                        "args": {"expression": "2+2"},
                    }
                ],
                budget_max=2,
                idempotency_key="task-metadata-tamper",
            )
            runtime.store.connection.execute(
                "UPDATE tasks SET budget_max=999 WHERE task_id=?",
                (metadata_task["task_id"],),
            )
            runtime.store.connection.commit()
            metadata_result = runtime.kernel.run_once(
                context,
                metadata_task["task_id"],
                "security-worker",
                runtime.fabric,
            )
            self.assertEqual(metadata_result["state"], "FAILED")
            self.assertIn(
                "task_request",
                runtime.kernel.verify_task(context, metadata_task["task_id"])[
                    "errors"
                ],
            )
            runtime.close()

    def test_modified_approval_grant_does_not_authorize_execution(self):
        with tempfile.TemporaryDirectory(prefix="axiom-approval-tamper-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard(
                "owner@example.test", "LongPasswordOne!2026", "One"
            )
            context = runtime.identity.authenticate(owner["session_token"])
            calls = []
            runtime.fabric.bind(
                AdapterBinding.local_candidate(
                    lane="automations_schedules",
                    adapter_id="approval-bound-schedule",
                    operations={"automation.schedule"},
                    adapter=lambda invocation: calls.append(invocation.invocation_id)
                    or {"scheduled": True},
                )
            )
            task = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [{"operation": "automation.schedule", "args": {}}],
                budget_max=2,
                idempotency_key="approval-tamper",
            )
            waiting = runtime.kernel.run_once(
                context, task["task_id"], "security-worker", runtime.fabric
            )
            step_id = waiting["steps"][0]["step_id"]
            runtime.kernel.approve_step(context, task["task_id"], step_id)
            runtime.store.connection.execute(
                """UPDATE approval_grants SET expires_at_ms=expires_at_ms+100000
                   WHERE task_id=? AND step_id=?""",
                (task["task_id"], step_id),
            )
            runtime.store.connection.commit()
            blocked = runtime.kernel.run_once(
                context, task["task_id"], "security-worker", runtime.fabric
            )
            self.assertEqual(blocked["state"], "AWAITING_APPROVAL")
            self.assertEqual(calls, [])
            runtime.close()

    def test_receipt_and_audit_tampering_return_fail_verdicts(self):
        with tempfile.TemporaryDirectory(prefix="axiom-evidence-tamper-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard(
                "owner@example.test", "LongPasswordOne!2026", "One"
            )
            context = runtime.identity.authenticate(owner["session_token"])
            completed = runtime.submit_arithmetic(
                owner["session_token"],
                owner["project_id"],
                "6*7",
                idempotency_key="evidence-tamper",
            )
            runtime.store.connection.execute(
                "UPDATE tool_receipts SET result_json=? WHERE task_id=?",
                (json.dumps({"value": 7}), completed["task_id"]),
            )
            runtime.store.connection.execute(
                """UPDATE audit_events SET details_json='{not-json'
                   WHERE organization_id=? AND sequence=(
                     SELECT MIN(sequence) FROM audit_events WHERE organization_id=?
                   )""",
                (owner["organization_id"], owner["organization_id"]),
            )
            runtime.store.connection.commit()
            self.assertEqual(
                runtime.kernel.verify_task(context, completed["task_id"])["status"],
                "FAIL",
            )
            self.assertEqual(
                runtime.identity.verify_audit(owner["organization_id"])["status"],
                "FAIL",
            )
            runtime.close()


if __name__ == "__main__":
    unittest.main()
