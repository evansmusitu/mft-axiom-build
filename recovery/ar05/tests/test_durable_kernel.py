import tempfile, unittest
from pathlib import Path
from recovery.ar05.durable_kernel import DurableKernel


class DurableKernelTests(unittest.TestCase):
    def test_survives_restart_timeout_and_post_commit_failure_without_duplicate_side_effect(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar05-") as td:
            path=Path(td)/"kernel.sqlite3"
            k=DurableKernel(path)
            task=k.create_task("tenant-a","project-a",[
                {"operation":"tool.timeout_once","args":{},"idempotency_key":"timeout-1","cost_units":1},
                {"operation":"side_effect.increment","args":{"effect_key":"external-write-1","fail_after_commit_once":True},"risk_class":"S1","idempotency_key":"write-1","cost_units":2},
                {"operation":"arithmetic.evaluate","args":{"expression":"40+2"},"idempotency_key":"math-1","cost_units":1},
            ],budget_max=10)

            self.assertEqual(k.run(task),"RETRYABLE")
            k.close()

            k=DurableKernel(path)
            self.assertEqual(k.run(task),"RETRYABLE")
            k.close()

            k=DurableKernel(path)
            self.assertEqual(k.run(task),"SUCCEEDED")
            effect=k.db.execute("SELECT value FROM side_effects WHERE effect_key='external-write-1'").fetchone()["value"]
            self.assertEqual(effect,1)
            st=k.status(task)
            self.assertEqual(st["task"]["budget_used"],4)
            self.assertTrue(all(s["status"]=="SUCCEEDED" for s in st["steps"]))
            kinds=[e["event_type"] for e in k.events(task)]
            self.assertGreaterEqual(kinds.count("step.transient_failure"),2)
            self.assertIn("task.succeeded",kinds)
            k.close()

    def test_approval_pause_cancel_and_budget(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar05-") as td:
            k=DurableKernel(Path(td)/"kernel.sqlite3")
            task=k.create_task("t","p",[
                {"operation":"arithmetic.evaluate","args":{"expression":"2+2"},"risk_class":"S3","idempotency_key":"a","cost_units":1}
            ],budget_max=2)
            self.assertEqual(k.run(task),"AWAITING_APPROVAL")
            step=k.status(task)["steps"][0]
            k.approve(task,step["id"],"human-1")
            self.assertEqual(k.run(task),"SUCCEEDED")

            task2=k.create_task("t","p",[
                {"operation":"arithmetic.evaluate","args":{"expression":"1+1"},"cost_units":3}
            ],budget_max=2)
            self.assertEqual(k.run(task2),"BUDGET_EXHAUSTED")

            task3=k.create_task("t","p",[
                {"operation":"arithmetic.evaluate","args":{"expression":"1+1"}}
            ])
            k.request_cancel(task3)
            self.assertEqual(k.run(task3),"CANCELLED")
            k.close()


if __name__=="__main__":
    unittest.main()
