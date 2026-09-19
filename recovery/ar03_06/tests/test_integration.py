import tempfile
import unittest
from pathlib import Path

from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class CandidateIntegrationTests(unittest.TestCase):
    def test_onboard_to_durable_result_artifact_and_reopen(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-06-") as td:
            database = Path(td) / "candidate.sqlite3"
            runtime = CandidateRuntime(database, secret_key=SECRET)
            owner = runtime.onboard("owner@example.test", "LongPasswordOne!2026", "One")
            first = runtime.submit_arithmetic(
                owner["session_token"], owner["project_id"], "40+2", idempotency_key="first-safe-task"
            )
            self.assertEqual(first["state"], "SUCCEEDED")
            self.assertEqual(first["result"], 42)
            self.assertFalse(first["manual_database_provisioning_required"])
            runtime.close()

            reopened = CandidateRuntime(database, secret_key=SECRET)
            session = reopened.identity.login("owner@example.test", "LongPasswordOne!2026")
            context = reopened.identity.authenticate(session["session_token"])
            task = reopened.kernel.status(context, first["task_id"])
            self.assertEqual(task["state"], "SUCCEEDED")
            entities = reopened.graph.list_entities(context, owner["project_id"])
            artifacts = [row for row in entities if row["entity_type"] == "ARTIFACT"]
            self.assertEqual(len(artifacts), 1)
            replay = reopened.submit_arithmetic(
                session["session_token"], owner["project_id"], "40+2", idempotency_key="first-safe-task"
            )
            self.assertEqual(replay["task_id"], first["task_id"])
            self.assertEqual(replay["result"], 42)
            self.assertEqual(reopened.graph.verify_project(context, owner["project_id"])["status"], "PASS")
            reopened.close()


if __name__ == "__main__":
    unittest.main()
