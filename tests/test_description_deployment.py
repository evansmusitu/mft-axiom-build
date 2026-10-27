import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("deploy_descriptions", ROOT / "deploy_description_only.py")
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)
BASELINE = (ROOT / "baseline/mcp/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
CANDIDATE = (ROOT / "candidate/mcp/musitu_axiom_plugin_gate_v4.mjs").read_bytes()


class FakeClient:
    initial = BASELINE
    fail_settings = False
    ambiguous_write = False
    instance = None

    def __init__(self):
        type(self).instance = self
        self.source = self.initial
        self.writes = []

    def module(self):
        return "index.mjs", self.source

    def settings(self):
        return {"bindings": [{"type": "service", "name": "MCP_CORE", "service": "unchanged-core"}], "compatibility_date": "2026-09-05", "drift": self.fail_settings and self.source == CANDIDATE}

    def public(self, path):
        return {"ok": True, "oauth_enforced": True} if path == "/health" else {"resource": DEPLOY.RESOURCE, "scopes_supported": ["axiom.execute"]}

    def put(self, name, source):
        self.writes.append(source)
        self.source = source
        if self.ambiguous_write and source == CANDIDATE:
            raise TimeoutError("simulated response loss")
        return {"etag": "test-only-etag"}

    def rpc(self, method, params=None):
        if method == "tools/list":
            descriptions = "Explain the calculation and its input data." if self.source == CANDIDATE else "Execute certified MUSITU Axiom operation placeholder."
            tools = [{"name": "quantitative_" + str(i), "description": descriptions, "_meta": {"musitu/operation": "operation_" + str(i)}, "inputSchema": {"type": "object"}} for i in range(104)]
            tools += [{"name": name, "description": "unchanged", "inputSchema": {"type": "object"}} for name in ["search", "fetch", "musitu_axiom_capabilities", "musitu_axiom_execute"]]
            return {"result": {"tools": tools}}
        if params["name"] == "search":
            return {"result": {"structuredContent": {"results": [{"id": "tool:moving_average"}]}}}
        if params["name"] in DEPLOY.HIDDEN:
            return {"error": {"code": -32601}}
        return {"result": {"structuredContent": {"authenticated": False}}}


class DescriptionDeploymentTests(unittest.TestCase):
    def setUp(self):
        FakeClient.initial = BASELINE
        FakeClient.fail_settings = False
        FakeClient.ambiguous_write = False
        FakeClient.instance = None

    def run_main(self, expected_error=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "candidate/mcp").mkdir(parents=True)
            (root / "candidate/mcp/musitu_axiom_plugin_gate_v4.mjs").write_bytes(CANDIDATE)
            real_old = Path.cwd()
            try:
                os.chdir(root)
                with patch.object(DEPLOY, "Client", FakeClient), patch("builtins.print"):
                    if expected_error:
                        with self.assertRaisesRegex(RuntimeError, expected_error):
                            DEPLOY.main()
                    else:
                        DEPLOY.main()
                return json.loads((root / "deployment-evidence/deployment-result.json").read_text())
            finally:
                os.chdir(real_old)

    def test_content_payload_has_no_configuration_changes(self):
        content_type, body = DEPLOY.multipart("index.mjs", CANDIDATE)
        name, source = DEPLOY.parse_module({"Content-Type": content_type}, body)
        self.assertEqual((name, source), ("index.mjs", CANDIDATE))
        self.assertNotIn(b'"bindings"', body)
        self.assertNotIn(b'"compatibility_date"', body)

    def test_multiple_modules_are_rejected(self):
        content_type, body = DEPLOY.multipart("index.mjs", CANDIDATE)
        boundary = content_type.split("boundary=")[1].encode()
        extra = b'--' + boundary + b'\r\nContent-Disposition: form-data; name="other.mjs"; filename="other.mjs"\r\n\r\nexport default {};\r\n'
        body = body.replace(b'--' + boundary + b'--\r\n', extra + b'--' + boundary + b'--\r\n')
        with self.assertRaisesRegex(RuntimeError, "single-module"):
            DEPLOY.parse_module({"Content-Type": content_type}, body)

    def test_other_cloudflare_writes_are_rejected(self):
        client = object.__new__(DEPLOY.Client)
        client.admin = {}
        with self.assertRaisesRegex(RuntimeError, "only replace"):
            client.cf("/settings", "PUT", body=b"{}")
        with self.assertRaisesRegex(RuntimeError, "only replace"):
            client.cf("/content", "POST", body=b"{}")

    def test_legacy_read_fallback_is_read_only_and_cached(self):
        client = object.__new__(DEPLOY.Client)
        calls = []
        def cf(suffix, method="GET", headers=None, body=None):
            calls.append((suffix, method))
            if suffix == "/content/v2":
                raise DEPLOY.CloudflareError(403, suffix, [10000])
            return {"Content-Type": "application/javascript", "CF-WORKER-MAIN-MODULE-PART": "index.mjs"}, BASELINE
        client.cf = cf
        self.assertEqual(client.module(), ("index.mjs", BASELINE))
        self.assertEqual(client.module(), ("index.mjs", BASELINE))
        self.assertEqual(calls, [("/content/v2", "GET"), ("", "GET"), ("", "GET")])

    def test_cloudflare_errors_expose_codes_without_response_data(self):
        client = object.__new__(DEPLOY.Client)
        client.admin = {}
        client.request = lambda *args, **kwargs: (403, {}, b'{"errors":[{"code":10000,"message":"private diagnostic text"}]}')
        with self.assertRaisesRegex(DEPLOY.CloudflareError, "10000") as captured:
            client.cf("/content/v2")
        self.assertNotIn("private diagnostic text", str(captured.exception))

    def test_source_drift_stops_without_a_write(self):
        FakeClient.initial = b"different operator source"
        report = self.run_main("Live source does not match")
        self.assertEqual(report["status"], "STOPPED_SOURCE_DRIFT")
        self.assertEqual(FakeClient.instance.writes, [])

    def test_verified_deployment_writes_once_and_keeps_backup(self):
        report = self.run_main()
        self.assertEqual(report["status"], "DEPLOYED_VERIFIED")
        self.assertEqual(report["description_coverage"], 104)
        self.assertEqual(FakeClient.instance.writes, [CANDIDATE])
        self.assertEqual(report["rollback_source_sha256"], DEPLOY.BASELINE_SHA)

    def test_ambiguous_write_is_read_back_without_repeating_it(self):
        FakeClient.ambiguous_write = True
        report = self.run_main()
        self.assertEqual(report["status"], "DEPLOYED_VERIFIED")
        self.assertEqual(report["write_response"], "uncertain_but_candidate_read_back")
        self.assertEqual(FakeClient.instance.writes, [CANDIDATE])

    def test_verification_failure_rolls_back_only_our_candidate(self):
        FakeClient.fail_settings = True
        report = self.run_main("configuration changed")
        self.assertEqual(report["rollback"], "verified")
        self.assertEqual(FakeClient.instance.writes, [CANDIDATE, BASELINE])
        self.assertEqual(FakeClient.instance.source, BASELINE)

    def test_already_deployed_candidate_is_not_written_again(self):
        FakeClient.initial = CANDIDATE
        report = self.run_main()
        self.assertEqual(report["status"], "DEPLOYED_VERIFIED")
        self.assertEqual(report["write_response"], "already_deployed_no_write")
        self.assertEqual(FakeClient.instance.writes, [])


if __name__ == "__main__":
    unittest.main()
