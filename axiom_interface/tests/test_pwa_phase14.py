from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SEC = (ROOT / "pwa_security.js").read_text(encoding="utf-8")
QUEUE = (ROOT / "pwa_queue.js").read_text(encoding="utf-8")
RUNTIME = (ROOT / "pwa_runtime.js").read_text(encoding="utf-8")
BOOT = (ROOT / "pwa_bootstrap.js").read_text(encoding="utf-8")
EVIDENCE_BOOT = (ROOT / "evidence_bootstrap.js").read_text(encoding="utf-8")
CSS = (ROOT / "styles/pwa.css").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))
BROWSER = (ROOT / "tests/run_browser_phase14.py").read_text(encoding="utf-8")


class Phase14PwaContractTests(unittest.TestCase):
    def test_installable_standalone_shell_metadata(self):
        self.assertEqual(MANIFEST["id"], "./")
        self.assertEqual(MANIFEST["scope"], "./")
        self.assertEqual(MANIFEST["display"], "standalone")
        self.assertIn("standalone", MANIFEST["display_override"])
        self.assertEqual(MANIFEST["orientation"], "any")
        self.assertEqual(MANIFEST["launch_handler"]["client_mode"], "navigate-existing")
        self.assertGreaterEqual(len(MANIFEST["shortcuts"]), 2)
        for token in ["beforeinstallprompt", "appinstalled", "display-mode: standalone", "Install Axiom", "serviceWorker.ready"]:
            self.assertIn(token, RUNTIME)

    def test_cached_shell_offline_projects_and_reconnect_are_visible(self):
        for token in ["Offline project access", "Reconnect queue", "CACHED_SHELL_AND_BROWSER_LOCAL_PROJECT_ACCESS", "storage.persist", "projects.store.listProjects"]:
            self.assertIn(token, SEC + RUNTIME)
        for token in ["self.skipWaiting()", "self.clients.claim()", "event.request.mode==='navigate'", "caches.match('./index.html')"]:
            self.assertIn(token, SW)

    def test_queue_is_exact_allowlisted_local_only(self):
        for token in ["LOCAL_PROJECT_REFRESH", "LOCAL_DRAFT_CHECKPOINT", "LOCAL_EVIDENCE_SNAPSHOT", "ALLOWLISTED_LOCAL_ACTIONS_ONLY_NO_EXTERNAL_SIDE_EFFECTS", "EXACT_ACTION_SHA256_IDEMPOTENT_RECONNECT_REPLAY"]:
            self.assertIn(token, SEC + QUEUE)
        for token in ["stale or altered offline action preview", "queued action integrity failure", "COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT", "external_side_effect:false", "receipt_sha256"]:
            self.assertIn(token, QUEUE)
        for forbidden in ["EXTERNAL_WEBHOOK_DELIVERY", "PAYMENT", "TRADE", "EMAIL_SEND"]:
            self.assertNotIn(forbidden, SEC + QUEUE + RUNTIME)

    def test_constrained_network_and_mobile_ergonomics_are_explicit(self):
        for token in ["slow-2g", "2g", "3g", "saveData", "downlink", "data-network-profile"]:
            self.assertIn(token, SEC + RUNTIME + CSS)
        self.assertIn("max-width:52rem", CSS)
        self.assertIn("max-width:30rem", CSS)
        self.assertIn("min-height:3rem", CSS)
        self.assertIn("prefers-reduced-motion:reduce", CSS)

    def test_browser_matrix_aligns_transport_and_navigator_offline_state(self):
        self.assertIn('context.set_offline(True)', BROWSER)
        self.assertIn('"Network.emulateNetworkConditions"', BROWSER)
        self.assertIn('"Network.overrideNetworkState"', BROWSER)
        self.assertIn('assert page.evaluate("()=>navigator.onLine") is False', BROWSER)
        self.assertGreaterEqual(BROWSER.count("emulate_constrained_network(session, offline=True)"), 2)
        self.assertIn("window.dispatchEvent(new Event('offline'))", BROWSER)
        self.assertIn("row.action_id===actionId", BROWSER)
        self.assertIn('row["action_id"] == action["action_id"]', BROWSER)

    def test_real_device_boundary_is_fail_closed(self):
        for token in ["BROWSER_EMULATED_MID_TIER_AND_CONSTRAINED_NETWORK_CANDIDATE_ONLY", "AUTHENTICATED_REAL_MID_TIER_DEVICE_MATRIX_REQUIRED_FOR_PHASE14_SEAL", "real_device_certification_claimed:false", "phase14_earned:false"]:
            self.assertIn(token, SEC + RUNTIME)
        self.assertIn("Browser emulation can prove responsive behavior but cannot self-certify a real mid-tier device", RUNTIME)

    def test_progressive_bootstrap_and_offline_cache(self):
        self.assertIn("AxiomPwaHardeningBootstrap", BOOT)
        self.assertIn("import('./pwa_bootstrap.js')", EVIDENCE_BOOT)
        for asset in ["./pwa_bootstrap.js", "./pwa_security.js", "./pwa_queue.js", "./pwa_runtime.js", "./styles/pwa.css"]:
            self.assertIn(asset, SW)
        self.assertIn("axiom-interface-phase14-candidate-v1", SW)
        self.assertIn("axiom-interface-phase13-candidate-v1", SW)

    def test_no_external_transport_or_dynamic_execution_in_phase14_modules(self):
        for text in [SEC, QUEUE, RUNTIME, BOOT]:
            for token in ["fetch(", "WebSocket(", "EventSource(", "new Function(", "eval("]:
                self.assertNotIn(token, text)

    def test_phase14_is_not_claimed_before_real_device_matrix_and_seal(self):
        phase14 = SURFACE["authority"].get("qualified_phase14_sha")
        if phase14 is None:
            self.assertNotIn("pwa_native_hardening_substrate", SURFACE)
            return
        self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v14")
        self.assertEqual(SURFACE["phase"], "PHASE_14_PWA_NATIVE_HARDENING")
        self.assertEqual(SURFACE["pwa_native_hardening_substrate"]["status"], "EARNED")
        self.assertTrue(SURFACE["authority"]["qualified_phase14_real_device_matrix_binding_verified"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
