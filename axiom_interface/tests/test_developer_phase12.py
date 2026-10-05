from __future__ import annotations
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SEC = (ROOT / "developer_security.js").read_text(encoding="utf-8")
STORE = (ROOT / "developer_store.js").read_text(encoding="utf-8")
UI = (ROOT / "developer_ui.js").read_text(encoding="utf-8")
BOOT = (ROOT / "developer_bootstrap.js").read_text(encoding="utf-8")
OPERATOR_BOOT = (ROOT / "operator_bootstrap.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))


class Phase12DeveloperPlatformContractTests(unittest.TestCase):
    def test_progressive_developer_platform_is_user_facing(self):
        for token in ["Developer platform & marketplace", "Symbolic API credential", "Agent package or template", "Marketplace install", "Webhook declaration", "SDK, MCP & A2A bindings"]:
            self.assertIn(token, UI)
        self.assertIn("/^#\\/developer", UI)
        self.assertIn("AxiomDeveloperPlatformBootstrap", BOOT)
        self.assertIn("import('./developer_bootstrap.js')", OPERATOR_BOOT)

    def test_static_package_and_exact_install_controls(self):
        for token in ["normalizePackage", "AGENT_PACKAGE", "TEMPLATE", "sdk.python", "sdk.javascript", "mcp.2026", "a2a.v1", "webhook.v1"]:
            self.assertIn(token, SEC)
        for token in ["registerPackage", "prepareInstall", "applyInstall", "stale or altered package install preview", "package_sha256", "install_sha256", "granted_permissions"]:
            self.assertIn(token, STORE)

    def test_credentials_webhooks_sdk_mcp_and_a2a_are_bounded(self):
        for token in ["registerCredentialHandle", "declareWebhook", "previewWebhookEvent", "sdkBundle", "conformance"]:
            self.assertIn(token, STORE)
        for token in ["SYMBOLIC_HANDLE_ONLY_NO_PLAINTEXT_API_KEYS", "DECLARATION_AND_LOCAL_SIGNED_FIXTURE_ONLY_NO_DELIVERY", "MCP_2026_LOCAL_CONFORMANCE_ONLY_NO_REMOTE_BINDING", "A2A_LOCAL_CAPABILITY_CARD_CONFORMANCE_ONLY"]:
            self.assertIn(token, SEC)
        for token in ["production_api_key_issued:false", "remote_mcp_binding_claimed:false", "outbound_webhook_delivery_claimed:false", "untrusted_package_code_executed:false"]:
            self.assertIn(token, STORE)

    def test_external_transport_and_untrusted_execution_are_absent(self):
        for text in [SEC, STORE, UI, BOOT]:
            self.assertNotIn("fetch(", text)
            self.assertNotIn("WebSocket(", text)
            self.assertNotIn("EventSource(", text)
            self.assertNotIn("new Function(", text)
            self.assertNotIn("eval(", text)
        for token in ["DENY_ALL_EXTERNAL_NETWORK", "STATIC_MANIFEST_VALIDATION_NO_UNTRUSTED_CODE_EXECUTION", "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY"]:
            self.assertIn(token, SEC)

    def test_tamper_evident_history_and_receipts(self):
        for token in ["previous_event_sha256", "event_sha256", "receipt_sha256", "credential_fingerprint_sha256", "webhook_sha256", "verify(orgId)"]:
            self.assertIn(token, STORE)

    def test_offline_shell_contains_phase12_assets(self):
        for asset in ["./developer_bootstrap.js", "./developer_security.js", "./developer_store.js", "./developer_ui.js", "./styles/developer.css"]:
            self.assertIn(asset, SW)
        self.assertIn("axiom-interface-phase12-v1", SW)
        self.assertIn("axiom-interface-phase11-v1", SW)

    def test_phase12_is_not_claimed_before_qualification_and_seal(self):
        phase12 = SURFACE["authority"].get("qualified_phase12_sha")
        if phase12 is None:
            self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v11")
            self.assertEqual(SURFACE["phase"], "PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE")
            self.assertEqual(SURFACE["operator_enterprise_control_plane_substrate"]["status"], "EARNED")
            self.assertNotIn("developer_platform_marketplace_substrate", SURFACE)
            return
        self.assertEqual(phase12, "cabb5767157afa2f688ef5718eee9452b7d98177")
        self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v12")
        self.assertEqual(SURFACE["phase"], "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE")
        authority = SURFACE["authority"]
        self.assertEqual(authority["qualified_phase12_run_id"], 34750659969)
        self.assertEqual(authority["qualified_phase12_evidence_artifact_id"], 10320127344)
        self.assertEqual(authority["qualified_phase12_evidence_digest"], "sha256:3874ed2cb8b3081912ba8e09b6944b11a5f6d63628683f5a074582f8d84d6770")
        self.assertEqual(authority["qualified_phase12_runtime_security_artifact_id"], 10321060112)
        self.assertEqual(authority["qualified_phase12_runtime_security_evidence_digest"], "sha256:565648d88b14e1ce4b4d8bc319cadee65a1624219fae4be0d2bbf74b00b8754d")
        self.assertTrue(authority["qualified_phase12_artifact_binding_verified"])
        dev = SURFACE["developer_platform_marketplace_substrate"]
        self.assertEqual(dev["status"], "EARNED")
        self.assertEqual(dev["qualified_sha"], phase12)
        self.assertEqual(dev["workflow_run_id"], 34750659969)
        self.assertEqual(dev["workflow_run_attempt"], 9)
        self.assertEqual(dev["evidence_artifact_id"], 10320127344)
        self.assertEqual(dev["runtime_security_evidence_artifact_id"], 10321060112)
        self.assertEqual(dev["network_policy"], "DENY_ALL_EXTERNAL_NETWORK")
        self.assertEqual(dev["platform_mode"], "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY")
        self.assertFalse(dev["production_api_key_issued"])
        self.assertFalse(dev["remote_mcp_binding_claimed"])
        self.assertFalse(dev["outbound_webhook_delivery_claimed"])
        self.assertFalse(dev["untrusted_package_code_executed"])
        self.assertFalse(dev["external_conformance_certification_claimed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
