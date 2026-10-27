import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import deploy_ewma_title_only as deploy

ORIGINAL = (ROOT / "candidate/mcp/musitu_axiom_plugin_gate_v4.mjs").read_bytes()
REFERENCE = (ROOT / "ewma-title-candidate/musitu_axiom_plugin_gate_v4.mjs").read_bytes()


def tools(title):
    result = [{"name": "ewma_forecast" if i == 0 else f"operation_{i}", "title": title if i == 0 else str(i), "description": "Unchanged calculation description", "_meta": {"musitu/operation": "timeseries.ewma" if i == 0 else str(i)}, "inputSchema": {"type": "object"}} for i in range(104)]
    return result + [{"name": n, "description": "unchanged"} for n in ["search", "fetch", "musitu_axiom_capabilities", "musitu_axiom_execute"]]


class FakeClient:
    initial = ORIGINAL
    ambiguous = False
    fail_settings = False
    concurrent_drift = False
    instance = None

    def __init__(self):
        type(self).instance = self
        self.source = self.initial
        self.writes = []

    def module(self):
        return "index.mjs", self.source

    def settings(self):
        changed = deploy.NEW in self.source
        if self.concurrent_drift and changed:
            self.source = b"another operator's source"
            return {"unrelated_operator_settings": True}
        return {"bindings": ["unchanged"], "drift": self.fail_settings and changed}

    def public(self, path):
        return {"ok": True, "oauth_enforced": True} if path == "/health" else {"resource": "unchanged", "scopes_supported": ["axiom.execute"]}

    def put(self, name, source):
        self.writes.append(source)
        self.source = source
        if self.ambiguous and deploy.NEW in source:
            raise TimeoutError("simulated response loss")
        return {"etag": "test-only-etag"}

    def rpc(self, method, params=None):
        title = deploy.TITLE if deploy.NEW in self.source else "Ewma Forecast"
        if method == "tools/list":
            return {"result": {"tools": tools(title)}}
        if params["name"] == "search":
            return {"result": {"structuredContent": {"results": [{"id": "tool:ewma_forecast", "title": title}]}}}
        if params["name"] == "fetch":
            return {"result": {"structuredContent": {"resource": {"name": "ewma_forecast", "title": title}}}}
        if params["name"] in deploy.HIDDEN:
            return {"error": {"code": -32601}}
        return {"result": {"structuredContent": {"authenticated": False}}}


class TitleDeploymentTests(unittest.TestCase):
    def setUp(self):
        FakeClient.initial = ORIGINAL
        FakeClient.ambiguous = FakeClient.fail_settings = FakeClient.concurrent_drift = False
        FakeClient.instance = None

    def run_main(self, error=None):
        old = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ewma-title-candidate").mkdir()
            (root / "ewma-title-candidate/musitu_axiom_plugin_gate_v4.mjs").write_bytes(REFERENCE)
            try:
                os.chdir(root)
                with patch.object(deploy, "Client", FakeClient), patch.object(deploy, "LIVE_SHA", deploy.sha(ORIGINAL)), patch.object(deploy.time, "sleep"), patch("builtins.print"):
                    if error:
                        with self.assertRaisesRegex(RuntimeError, error):
                            deploy.main()
                    else:
                        deploy.main()
                return json.loads((root / "title-deployment-evidence/deployment-result.json").read_text())
            finally:
                os.chdir(old)

    def test_title_patch_preserves_every_other_source_byte(self):
        with patch.object(deploy, "LIVE_SHA", deploy.sha(ORIGINAL)):
            updated, write = deploy.candidate_for_module(ORIGINAL)
        self.assertTrue(write)
        self.assertEqual(updated.replace(deploy.NEW, deploy.OLD, 1), ORIGINAL)
        self.assertEqual(updated, REFERENCE)

    def test_source_drift_stops_before_any_write(self):
        FakeClient.initial = b"unrelated source"
        report = self.run_main("differs from the approved")
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(FakeClient.instance.writes, [])

    def test_successful_deploy_writes_once_and_verifies(self):
        report = self.run_main()
        self.assertEqual(report["status"], "DEPLOYED_VERIFIED")
        self.assertEqual(FakeClient.instance.writes, [REFERENCE])
        self.assertEqual(report["settings_sha256_before"], report["settings_sha256_after"])

    def test_ambiguous_write_is_read_back_without_a_repeat(self):
        FakeClient.ambiguous = True
        report = self.run_main()
        self.assertEqual(report["write_response"], "uncertain_but_candidate_read_back")
        self.assertEqual(FakeClient.instance.writes, [REFERENCE])

    def test_verification_failure_rolls_back_only_our_source(self):
        FakeClient.fail_settings = True
        report = self.run_main("settings changed")
        self.assertEqual(report["rollback"], "verified")
        self.assertEqual(FakeClient.instance.writes, [REFERENCE, ORIGINAL])

    def test_concurrent_operator_source_is_never_overwritten_by_rollback(self):
        FakeClient.concurrent_drift = True
        report = self.run_main("title is missing")
        self.assertEqual(report["rollback"], "stopped_source_drift")
        self.assertEqual(FakeClient.instance.writes, [REFERENCE])

    def test_already_deployed_title_does_not_write(self):
        FakeClient.initial = REFERENCE
        report = self.run_main()
        self.assertEqual(report["status"], "DEPLOYED_VERIFIED")
        self.assertEqual(FakeClient.instance.writes, [])

    def test_metadata_change_outside_title_is_rejected(self):
        before = tools("Ewma Forecast")
        after = copy.deepcopy(tools(deploy.TITLE))
        after[2]["inputSchema"]["unexpected"] = True
        with self.assertRaisesRegex(RuntimeError, "outside the EWMA"):
            deploy.validate_tools(before, after)


if __name__ == "__main__":
    unittest.main()
