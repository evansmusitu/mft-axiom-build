import base64
import unittest
from verify_import import verify_persisted_notebook


SAMPLE = b"# Databricks notebook source\nprint(42)\n"


class PersistedNotebookTests(unittest.TestCase):
    def test_matches_exported_source_after_read_only_api_calls(self):
        calls = []
        def api(method, path, params=None):
            calls.append((method, path, params))
            if path.endswith("/Me"):
                return {"userName": "tester@example.com"}
            if path.endswith("/get-status"):
                return {"object_type": "NOTEBOOK", "language": "PYTHON", "object_id": 301}
            if path.endswith("/export"):
                return {"content": base64.b64encode(SAMPLE).decode(), "file_type": "py"}
            raise AssertionError(path)
        result = verify_persisted_notebook(api, SAMPLE)
        self.assertEqual(result["object_id"], 301)
        self.assertEqual(result["result"], "VERIFIED_SOURCE_MATCH")
        self.assertEqual([c[1] for c in calls], [
            "/api/2.0/preview/scim/v2/Me",
            "/api/2.0/workspace/get-status",
            "/api/2.0/workspace/export",
        ])
        self.assertTrue(all(c[0] == "GET" for c in calls))
        self.assertIn("MUSITU_AXIOM_PRIVATE_PILOT_20261027", calls[1][2]["path"])

    def test_source_mismatch_fails_closed(self):
        def api(method, path, params=None):
            if path.endswith("/Me"):
                return {"userName": "tester@example.com"}
            if path.endswith("/get-status"):
                return {"object_type": "NOTEBOOK", "language": "PYTHON", "object_id": 301}
            return {"content": base64.b64encode(SAMPLE + b"evil()\n").decode(), "file_type": "py"}
        with self.assertRaisesRegex(RuntimeError, "content mismatch"):
            verify_persisted_notebook(api, SAMPLE)

    def test_invalid_object_type_fails_without_export(self):
        calls = []
        def api(method, path, params=None):
            calls.append(path)
            if path.endswith("/Me"):
                return {"userName": "tester@example.com"}
            return {"object_type": "DIRECTORY", "object_id": 301}
        with self.assertRaisesRegex(RuntimeError, "Python notebook"):
            verify_persisted_notebook(api, SAMPLE)
        self.assertNotIn("/api/2.0/workspace/export", calls)

    def test_malformed_export_fails(self):
        def api(method, path, params=None):
            if path.endswith("/Me"):
                return {"userName": "tester@example.com"}
            if path.endswith("/get-status"):
                return {"object_type": "NOTEBOOK", "language": "PYTHON", "object_id": 301}
            return {"content": "%%%notbase64", "file_type": "py"}
        with self.assertRaisesRegex(RuntimeError, "export"):
            verify_persisted_notebook(api, SAMPLE)


if __name__ == "__main__":
    unittest.main()
