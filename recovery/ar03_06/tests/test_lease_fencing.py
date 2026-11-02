import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from recovery.ar03_06.common import PermanentAdapterError
from recovery.ar03_06.fabric import AdapterBinding, ExecutionContext, UnifiedToolFabric
from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class LeaseFencingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="axiom-lease-")
        self.path = Path(self.tmp.name) / "candidate.sqlite3"
        self.first = CandidateRuntime(self.path, secret_key=SECRET)
        self.owner = self.first.onboard("owner@example.test", "LongPasswordOne!2026", "One")
        self.context = self.first.identity.authenticate(self.owner["session_token"])
        self.second = CandidateRuntime(self.path, secret_key=SECRET)
        self.context2 = self.second.identity.authenticate(self.owner["session_token"])
        self.clock = patch("recovery.ar03_06.kernel.now_ms", return_value=100_000)
        self.time = self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.second.close()
        self.first.close()
        self.tmp.cleanup()

    def task(self):
        return self.first.kernel.create_task(
            self.context, self.owner["project_id"],
            [{"operation": "arithmetic.evaluate", "args": {"expression": "40+2"}}],
            budget_max=2, idempotency_key="fencing-task",
        )["task_id"]

    def bind(self, runtime, callback):
        runtime.fabric = UnifiedToolFabric()
        runtime.kernel.fabric = runtime.fabric
        runtime.fabric.bind(AdapterBinding.local_candidate(
            lane="quantitative", adapter_id="lease-regression",
            operations={"arithmetic.evaluate"}, adapter=callback,
        ))

    def test_stale_error_cannot_overwrite_reclaimed_success(self):
        task_id = self.task()
        self.bind(self.second, lambda invocation: {"value": 42})

        def stale(invocation):
            self.time.return_value += 30_001
            outcome = self.second.kernel.run_once(self.context2, task_id, "replacement")
            self.assertEqual(outcome["state"], "SUCCEEDED")
            raise PermanentAdapterError("late failure from old lease")

        self.bind(self.first, stale)
        result = self.first.kernel.run_once(self.context, task_id, "original")
        self.assertEqual(result["state"], "SUCCEEDED")
        self.assertEqual(result["steps"][0]["output"], {"value": 42})
        self.assertEqual(result["budget_used"], 1)
        self.assertEqual(self.first.kernel.verify_task(self.context, task_id)["status"], "PASS")

    def test_same_worker_name_does_not_reuse_expired_generation(self):
        task_id = self.task()
        old = self.first.kernel._claim(task_id, "worker")
        self.time.return_value += 30_001
        current = self.second.kernel._claim(task_id, "worker")
        self.assertEqual(current["attempts"], old["attempts"] + 1)
        self.first.kernel._record_failure(task_id, old, PermanentAdapterError("stale"), False)
        result = self.second.kernel.status(self.context2, task_id)
        self.assertEqual(result["state"], "RUNNING")
        self.assertIsNone(result["steps"][0]["last_error"])

    def test_same_worker_name_cannot_commit_success_from_previous_generation(self):
        task_id = self.task()
        old = self.first.kernel._claim(task_id, "worker")
        task = self.first.kernel._authorize_task(self.context, task_id)
        receipt = self.first.fabric.invoke(
            "arithmetic.evaluate", {"expression": "40+2"},
            ExecutionContext(organization_id=self.context.organization_id,
                             project_id=task["project_id"], actor_id=task["actor_id"],
                             task_id=task_id, step_id=old["step_id"],
                             instruction_provenance="GOVERNED_PLAN"),
            old["invocation_id"],
        )
        self.time.return_value += 30_001
        self.second.kernel._claim(task_id, "worker")
        self.first.kernel._record_success(self.context, task, old, receipt, "worker")
        result = self.second.kernel.status(self.context2, task_id)
        self.assertEqual(result["state"], "RUNNING")
        self.assertEqual(result["budget_used"], 0)
        self.assertIsNone(result["steps"][0]["output"])

    def test_expired_success_is_discarded_and_recovered_after_reopen(self):
        task_id = self.task()

        def expired(invocation):
            self.time.return_value += 30_001
            return {"value": 999}

        self.bind(self.first, expired)
        result = self.first.kernel.run_once(self.context, task_id, "expired")
        self.assertEqual(result["state"], "RUNNING")
        self.assertEqual(result["budget_used"], 0)
        self.assertIsNone(result["steps"][0]["output"])
        self.second.close()
        self.second = CandidateRuntime(self.path, secret_key=SECRET)
        self.context2 = self.second.identity.authenticate(self.owner["session_token"])
        self.bind(self.second, lambda invocation: {"value": 42})
        recovered = self.second.kernel.run_once(self.context2, task_id, "new-worker")
        self.assertEqual(recovered["state"], "SUCCEEDED")
        self.assertEqual(recovered["steps"][0]["output"], {"value": 42})
        self.assertEqual(recovered["budget_used"], 1)

    def test_cancellation_invalidates_pending_success_and_failure(self):
        for outcome in ("success", "failure"):
            with self.subTest(outcome=outcome):
                task_id = self.first.kernel.create_task(
                    self.context, self.owner["project_id"],
                    [{"operation": "arithmetic.evaluate", "args": {"expression": "40+2"}}],
                    budget_max=2, idempotency_key="cancel-" + outcome,
                )["task_id"]

                def late(invocation):
                    self.second.kernel.request_cancel(self.context2, task_id)
                    self.second.kernel.run_once(self.context2, task_id, "canceller")
                    if outcome == "failure":
                        raise PermanentAdapterError("late")
                    return {"value": 42}

                self.bind(self.first, late)
                result = self.first.kernel.run_once(self.context, task_id, "old-worker")
                self.assertEqual(result["state"], "CANCELLED")
                self.assertEqual(result["budget_used"], 0)
                self.assertIsNone(result["steps"][0]["output"])
                self.assertEqual(self.first.kernel.verify_task(self.context, task_id)["status"], "PASS")

    def test_verifier_rejects_inconsistent_task_step_receipt_and_budget_states(self):
        task_id = self.task()
        self.bind(self.first, lambda invocation: {"value": 42})
        self.first.kernel.run_once(self.context, task_id, "worker")
        self.first.store.connection.execute("UPDATE tasks SET state='FAILED',budget_used=0 WHERE task_id=?", (task_id,))
        self.first.store.connection.execute("UPDATE task_steps SET status='FAILED' WHERE task_id=?", (task_id,))
        verification = self.first.kernel.verify_task(self.context, task_id)
        self.assertEqual(verification["status"], "FAIL")
        self.assertTrue(any("receipt" in e or "output" in e or "budget" in e for e in verification["errors"]))


if __name__ == "__main__":
    unittest.main()
