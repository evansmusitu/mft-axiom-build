import sqlite3
import tempfile
import unittest
from pathlib import Path

from recovery.ar03_06.common import AuthorizationError, TransientAdapterError
from recovery.ar03_06.fabric import AdapterBinding
from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class DurableEffectAdapter:
    def __init__(self, path, fail_after_commit_once=True):
        self.path = str(path)
        self.fail_after_commit_once = fail_after_commit_once
        self.failed = False

    def __call__(self, invocation):
        db = sqlite3.connect(self.path)
        db.execute("CREATE TABLE IF NOT EXISTS effects(invocation_id TEXT PRIMARY KEY, calls INTEGER NOT NULL, value INTEGER NOT NULL)")
        row = db.execute("SELECT calls,value FROM effects WHERE invocation_id=?", (invocation.invocation_id,)).fetchone()
        if row:
            db.close()
            return {"value": row[1], "replayed": True}
        db.execute("INSERT INTO effects VALUES(?,?,?)", (invocation.invocation_id, 1, 1))
        db.commit()
        db.close()
        if self.fail_after_commit_once and not self.failed:
            self.failed = True
            raise TransientAdapterError("injected failure after durable side effect")
        return {"value": 1, "replayed": False}


class DurableKernelContractTests(unittest.TestCase):
    def test_restart_retry_uses_stable_invocation_and_no_duplicate_side_effect(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar05-") as td:
            root = Path(td)
            database = root / "candidate.sqlite3"
            effects = root / "effects.sqlite3"
            runtime = CandidateRuntime(database, secret_key=SECRET)
            owner = runtime.onboard("owner@example.test", "LongPasswordOne!2026", "One")
            context = runtime.identity.authenticate(owner["session_token"])
            runtime.fabric.bind(AdapterBinding.local_candidate(
                lane="artifact_engine",
                adapter_id="durable-effect-test",
                operations={"artifact.write"},
                adapter=DurableEffectAdapter(effects),
            ))
            task = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [{"operation": "artifact.write", "args": {"name": "proof"}, "idempotency_key": "effect-once", "cost_units": 2}],
                budget_max=10,
                idempotency_key="task-once",
            )
            self.assertEqual(runtime.kernel.run_once(context, task["task_id"], "worker-a", runtime.fabric)["state"], "RETRYABLE")
            runtime.close()

            reopened = CandidateRuntime(database, secret_key=SECRET)
            reopened_context = reopened.identity.login("owner@example.test", "LongPasswordOne!2026")
            context2 = reopened.identity.authenticate(reopened_context["session_token"])
            reopened.fabric.bind(AdapterBinding.local_candidate(
                lane="artifact_engine",
                adapter_id="durable-effect-test",
                operations={"artifact.write"},
                adapter=DurableEffectAdapter(effects, fail_after_commit_once=False),
            ))
            final = reopened.kernel.run_until_blocked(context2, task["task_id"], "worker-b", reopened.fabric)
            self.assertEqual(final["state"], "SUCCEEDED")
            check = sqlite3.connect(effects)
            self.assertEqual(check.execute("SELECT SUM(calls) FROM effects").fetchone()[0], 1)
            check.close()
            self.assertEqual(reopened.kernel.verify_task(context2, task["task_id"])["status"], "PASS")
            reopened.close()

    def test_approval_budget_cancel_and_risk_downgrade_are_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar05-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard("owner@example.test", "LongPasswordOne!2026", "One")
            context = runtime.identity.authenticate(owner["session_token"])
            runtime.fabric.bind(AdapterBinding.local_candidate(
                lane="automations_schedules",
                adapter_id="schedule-test",
                operations={"automation.schedule"},
                adapter=lambda invocation: {"scheduled": True},
            ))
            with self.assertRaises(AuthorizationError):
                runtime.kernel.create_task(
                    context,
                    owner["project_id"],
                    [{"operation": "automation.schedule", "risk_class": "S0", "args": {}}],
                    budget_max=5,
                    idempotency_key="risk-downgrade",
                )

            task = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [{"operation": "automation.schedule", "args": {}, "cost_units": 1}],
                budget_max=5,
                idempotency_key="approval-task",
            )
            waiting = runtime.kernel.run_once(context, task["task_id"], "worker", runtime.fabric)
            self.assertEqual(waiting["state"], "AWAITING_APPROVAL")
            step_id = waiting["steps"][0]["step_id"]
            runtime.kernel.approve_step(context, task["task_id"], step_id)
            self.assertEqual(runtime.kernel.run_until_blocked(context, task["task_id"], "worker", runtime.fabric)["state"], "SUCCEEDED")

            budget = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [{"operation": "arithmetic.evaluate", "args": {"expression": "1+1"}, "cost_units": 3}],
                budget_max=2,
                idempotency_key="budget-task",
            )
            self.assertEqual(runtime.kernel.run_once(context, budget["task_id"], "worker", runtime.fabric)["state"], "BUDGET_EXHAUSTED")

            cancelled = runtime.kernel.create_task(
                context,
                owner["project_id"],
                [{"operation": "arithmetic.evaluate", "args": {"expression": "1+1"}}],
                budget_max=2,
                idempotency_key="cancel-task",
            )
            runtime.kernel.request_cancel(context, cancelled["task_id"])
            self.assertEqual(runtime.kernel.run_once(context, cancelled["task_id"], "worker", runtime.fabric)["state"], "CANCELLED")
            runtime.close()


if __name__ == "__main__":
    unittest.main()
