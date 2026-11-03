"""Offline provider-shape attacks; no network, credentials or output files."""
import contextlib
import importlib.util
import http.client
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch


class MetadataReadback(unittest.TestCase):
    def run_subject(self, mutate=lambda payload: None, transport_exception=None):
        source = os.environ.get("AXIOM_METADATA_TEST_SUBJECT") or str(
            Path(__file__).resolve().parents[1] / "qualification/cloudflare_customer_inventory.py"
        )
        spec = importlib.util.spec_from_file_location("audit_subject", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        payload = [
            {"success": True, "result": [{"uuid": module.DATABASE, "name": module.DATABASE_NAME}],
             "result_info": {"page": 1, "total_pages": 1, "total_count": 1}},
            {"success": True, "result": {"uuid": module.DATABASE, "name": module.DATABASE_NAME}},
            {"success": True, "result": [{"id": "axiom-customer-staging"}]},
            {"success": True, "result": {"subdomain": "owned-account"}},
        ]
        mutate(payload)
        calls, files = [], {}

        class Response:
            status = 200
            def __init__(self, data): self.data = data
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return json.dumps(self.data).encode()[:size]

        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                if len(calls) == 1 and transport_exception is not None:
                    raise transport_exception
                return Response(payload[len(calls)-1])

        class Sink:
            def __init__(self, name): self.name = name
            def __str__(self): return self.name
            def write_bytes(self, data): files[self.name] = data
            def write_text(self, data): files[self.name] = data

        output = io.StringIO()
        with patch.object(module.urllib.request, "build_opener", return_value=Opener()), \
             patch.object(module, "Path", Sink), patch.dict(os.environ, {
                 "CLOUDFLARE_API_TOKEN": "OFFLINE-SYNTHETIC-ONLY",
                 "AXIOM_CHECKOUT_SHA": "checked-out-head",
                 "GITHUB_SHA": "synthetic-merge", "GITHUB_RUN_ID": "offline-fixture",
             }), contextlib.redirect_stdout(output):
            rc = module.inventory()
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(c.get_method() == "GET" for c in calls))
        self.assertTrue(all(c.full_url.startswith(module.API + "/") for c in calls))
        self.assertNotIn("OFFLINE-SYNTHETIC-ONLY", output.getvalue())
        self.assertIn("customer-cloudflare-readback.json.sha256", files)
        return rc, json.loads(files["customer-cloudflare-readback.json"])

    def assert_incomplete(self, mutate):
        rc, result = self.run_subject(mutate)
        self.assertEqual(rc, 1)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertFalse(result["hosted_migration_qualified"])
        self.assertFalse(result["release_authority"])

    def test_metadata_observation_is_not_release_or_migration(self):
        rc, result = self.run_subject()
        self.assertEqual(rc, 0)
        self.assertEqual(result["status"], "METADATA_OBSERVED")
        self.assertFalse(result["release_authority"])
        self.assertFalse(result["hosted_migration_qualified"])
        self.assertEqual(result["sql_queries"], 0)

    def test_workers_wrong_shape_never_qualifies(self):
        self.assert_incomplete(lambda p: p[2].update(result="not-a-worker-list"))

    def test_missing_pagination_is_not_complete_inventory(self):
        self.assert_incomplete(lambda p: p[0].pop("result_info"))

    def test_malformed_pagination_preserves_incomplete_evidence(self):
        self.assert_incomplete(lambda p: p[0].update(result_info=["wrong-shape"]))

    def test_malformed_subdomain_preserves_incomplete_evidence(self):
        self.assert_incomplete(lambda p: p[3].update(result=["wrong-shape"]))

    def test_wrong_selected_database_denies_identity_match(self):
        self.assert_incomplete(lambda p: p[1]["result"].update(uuid="other-database"))

    def test_selected_database_missing_from_inventory_is_incomplete(self):
        def mutate(p):
            p[0]["result"] = []
            p[0]["result_info"]["total_count"] = 0
        self.assert_incomplete(mutate)

    def test_subdomain_cannot_supply_an_external_url(self):
        self.assert_incomplete(lambda p: p[3]["result"].update(subdomain="https://foreign.example"))

    def test_checkout_and_event_provenance_are_distinct(self):
        _, result = self.run_subject()
        self.assertEqual(result["source_sha"], "checked-out-head")
        self.assertEqual(result["event_sha"], "synthetic-merge")

    def test_truncated_http_response_preserves_incomplete_artifact(self):
        rc, result = self.run_subject(transport_exception=http.client.IncompleteRead(b"offline-provider-detail", 100))
        self.assertEqual(rc, 1)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertNotIn("offline-provider-detail", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
