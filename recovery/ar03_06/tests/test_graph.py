import json
import tempfile
import unittest
from pathlib import Path

from recovery.ar03_06.common import ConflictError, TenantIsolationError
from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class ProjectWorkGraphContractTests(unittest.TestCase):
    def test_two_clients_converge_with_provenance_and_tenant_isolation(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar04-") as td:
            database = Path(td) / "candidate.sqlite3"
            first = CandidateRuntime(database, secret_key=SECRET)
            owner = first.onboard("owner@example.test", "LongPasswordOne!2026", "One")
            foreign = first.onboard("foreign@example.test", "LongPasswordTwo!2026", "Two")
            owner_context = first.identity.authenticate(owner["session_token"])
            foreign_context = first.identity.authenticate(foreign["session_token"])
            entity = first.graph.put_entity(
                owner_context,
                owner["project_id"],
                entity_type="WORK",
                body={"objective": "prove two-client continuity"},
                provenance={"source": "device-a"},
            )

            second = CandidateRuntime(database, secret_key=SECRET)
            owner_on_second = second.identity.login("owner@example.test", "LongPasswordOne!2026")
            second_context = second.identity.authenticate(owner_on_second["session_token"])
            sync = second.graph.sync(second_context, owner["project_id"], after_sequence=0, device_id="device-b")
            self.assertEqual(sync["entities"][0]["entity_id"], entity["entity_id"])
            self.assertTrue(sync["provenance_preserved"])
            self.assertEqual(second.graph.verify_project(second_context, owner["project_id"])["status"], "PASS")
            with self.assertRaises(TenantIsolationError):
                first.graph.sync(foreign_context, owner["project_id"], after_sequence=0, device_id="foreign")
            second.close()
            first.close()

    def test_local_import_is_idempotent_conflict_aware_and_tamper_evident(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar04-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            owner = runtime.onboard("owner@example.test", "LongPasswordOne!2026", "One")
            context = runtime.identity.authenticate(owner["session_token"])
            rows = [{
                "id": "legacy-work-1",
                "entity_type": "WORK",
                "body": {"objective": "import me"},
                "provenance": {"source": "legacy-local"},
            }]
            first = runtime.graph.import_local(context, owner["project_id"], "legacy-store", rows)
            second = runtime.graph.import_local(context, owner["project_id"], "legacy-store", rows)
            self.assertEqual(first, second)
            conflicting = [{**rows[0], "body": {"objective": "changed behind the same source id"}}]
            with self.assertRaises(ConflictError):
                runtime.graph.import_local(context, owner["project_id"], "legacy-store", conflicting)

            entity_id = first[0]
            runtime.store.connection.execute(
                "UPDATE graph_entities SET body_json=? WHERE organization_id=? AND project_id=? AND entity_id=?",
                (json.dumps({"tampered": True}), owner["organization_id"], owner["project_id"], entity_id),
            )
            runtime.store.connection.commit()
            verdict = runtime.graph.verify_project(context, owner["project_id"])
            self.assertEqual(verdict["status"], "FAIL")
            self.assertIn(f"entity_hash:{entity_id}", verdict["errors"])
            runtime.close()


if __name__ == "__main__":
    unittest.main()
