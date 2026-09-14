from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
PWA = (ROOT / "pwa_runtime.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))
BROWSER_RUNNER = (ROOT / "tests/run_browser_application.py").read_text(encoding="utf-8")


class BrowserApplicationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads((ROOT / "browser-app.json").read_text(encoding="utf-8"))
        cls.launch = (ROOT / "browser_app.js").read_text(encoding="utf-8")
        cls.session = (ROOT / "browser_session.js").read_text(encoding="utf-8")

    def test_canonical_entry_is_truthful_and_does_not_repurpose_api_edge(self):
        deployment = self.contract["deployment"]
        self.assertEqual(self.contract["schema"], "musitu.axiom.browser-application.v1")
        self.assertEqual(self.contract["status"], "IMPLEMENTED_NOT_DEPLOYED")
        self.assertEqual(deployment["public_entry_url"], "https://musitu.ai/axiom")
        self.assertIsNone(deployment["production_app_origin"])
        self.assertEqual(deployment["canonical_app_path"], "/")
        self.assertEqual(deployment["default_route"], "#/home")
        self.assertEqual(deployment["entry_url"], "./#/home")
        self.assertEqual(deployment["origin_policy"], "DEDICATED_APPLICATION_ORIGIN_REQUIRED")
        self.assertEqual(deployment["reserved_api_origin"], "https://axiom.mftintelligence.com")
        self.assertFalse(deployment["production_deployment_claimed"])

    def test_open_launch_is_inline_browser_navigation_never_a_download(self):
        action = self.contract["actions"]["open_browser"]
        self.assertEqual(action["href"], "./#/home")
        self.assertEqual(action["target"], "_self")
        self.assertEqual(action["media_type"], "text/html")
        self.assertFalse(action["download"])
        self.assertNotRegex(action["href"], re.compile(r"\.(?:apk|aab|ipa|dmg|pkg|exe|msi|zip)(?:[?#]|$)", re.I))
        self.assertIn('id="pwa-open-browser"', PWA)
        self.assertNotRegex(PWA, r'id="pwa-open-browser"[^>]*\bdownload(?:\s|=|>)')
        for token in ["normalizeBrowserEntry", "history.replaceState", "location.hash", "#/home"]:
            self.assertIn(token, self.launch)

    def test_static_build_is_inline_html_and_contains_no_native_package(self):
        hosting = self.contract["hosting"]
        self.assertEqual(hosting["artifact_type"], "STATIC_DIRECTORY")
        self.assertEqual(hosting["root_document"], "index.html")
        self.assertEqual(hosting["root_content_type"], "text/html; charset=utf-8")
        self.assertEqual(hosting["root_content_disposition"], "inline")
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "dist"
            subprocess.check_call([
                sys.executable,
                "frontier_v5/scripts/build_browser_application.py",
                "--output",
                str(output),
            ], cwd=ROOT.parent)
            built = json.loads((output / "build-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(built["status"], "PASS")
            self.assertEqual(built["content_disposition"], "inline")
            self.assertFalse(built["normal_launch_download"])
            self.assertTrue((output / "index.html").is_file())
            self.assertFalse(any(path.suffix.lower() in {".apk", ".aab", ".ipa", ".dmg", ".pkg", ".exe", ".msi", ".zip"} for path in output.rglob("*")))

    def test_hash_deep_links_refresh_without_host_rewrite_dependency(self):
        routing = self.contract["routing"]
        self.assertEqual(routing["mode"], "HASH_SPA")
        self.assertTrue(routing["direct_deep_links"])
        self.assertTrue(routing["refresh_safe"])
        self.assertEqual(routing["host_navigation_fallback"], "index.html")
        self.assertEqual(MANIFEST["start_url"], "./#/home")
        self.assertEqual(MANIFEST["scope"], "./")
        for shortcut in MANIFEST["shortcuts"]:
            self.assertTrue(shortcut["url"].startswith("./#/"), shortcut)
            self.assertNotIn("index.html", shortcut["url"])

    def test_browser_acceptance_uses_application_readiness_not_network_quiescence(self):
        self.assertNotIn('wait_until="networkidle"', BROWSER_RUNNER)
        for token in [
            'wait_until="domcontentloaded"',
            "window.AxiomBrowserApplication",
            "window.AxiomBrowserSessionReady",
            "window.AxiomPwaHardeningBootstrap",
            "#workspace-title",
        ]:
            self.assertIn(token, BROWSER_RUNNER)

    def test_session_is_same_origin_cookie_backed_and_fails_closed_to_guest(self):
        session = self.contract["session"]
        self.assertEqual(session["endpoint"], "./.well-known/axiom-session")
        self.assertEqual(session["credential_transport"], "HTTP_ONLY_SAME_ORIGIN_COOKIE")
        self.assertEqual(session["unauthenticated_mode"], "GUEST_BROWSER_WORKSPACE")
        self.assertEqual(session["offline_authenticated_mode"], "FAIL_CLOSED_TO_GUEST")
        self.assertFalse(session["browser_token_storage"])
        for token in [
            "credentials:'same-origin'",
            "cache:'no-store'",
            "redirect:'error'",
            "AbortController",
            "GUEST_BROWSER_WORKSPACE",
            "AUTHENTICATED_SAME_ORIGIN_SESSION",
            "rejectSecretFields",
            "sessionStorage",
        ]:
            self.assertIn(token, self.session)
        for forbidden in ["localStorage.setItem('access_token", "localStorage.setItem('refresh_token", "Authorization: Bearer"]:
            self.assertNotIn(forbidden, self.session)
        self.assertIn('id="session-button"', HTML)
        self.assertIn('id="session-dialog"', HTML)
        self.assertIn("initBrowserSession", APP)

    def test_pwa_and_native_install_paths_remain_explicitly_separate(self):
        actions = self.contract["actions"]
        self.assertEqual(actions["install_web_app"]["behavior"], "BROWSER_INSTALL_PROMPT_ONLY")
        self.assertFalse(actions["install_web_app"]["native_binary"])
        for platform in ("android", "ios", "desktop"):
            native = actions[f"install_{platform}"]
            self.assertEqual(native["status"], "NOT_CONFIGURED_IN_VERIFIED_AXIOM_SOURCE")
            self.assertIsNone(native["href"])
            self.assertTrue(native["separate_from_open_browser"])
        for token in ["Open Axiom in browser", "Install web app", "Native installation", "No verified native distribution link"]:
            self.assertIn(token, PWA)
        self.assertFalse(MANIFEST["prefer_related_applications"])
        self.assertEqual(MANIFEST["related_applications"], [])

    def test_service_worker_caches_app_shell_but_never_session_identity(self):
        for asset in ["./browser_app.js", "./browser_session.js", "./browser-app.json"]:
            self.assertIn(asset, SW)
        for token in ["/.well-known/axiom-session", "cache:'no-store'", "response.ok", "text/html"]:
            self.assertIn(token, SW)
        self.assertNotRegex(SW, r"SHELL\s*=\s*\[[^\]]*\.well-known/axiom-session")

    def test_candidate_truth_boundary_does_not_change_earned_phase_authority(self):
        browser = SURFACE["browser_application_substrate"]
        self.assertEqual(SURFACE["phase"], "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE")
        self.assertEqual(browser["status"], "IMPLEMENTED_NOT_DEPLOYED")
        self.assertEqual(browser["origin_policy"], "DEDICATED_APPLICATION_ORIGIN_REQUIRED")
        self.assertTrue(browser["browser_launch_implemented"])
        self.assertTrue(browser["authenticated_session_contract_implemented"])
        self.assertFalse(browser["production_deployment_claimed"])
        self.assertFalse(browser["production_identity_integration_claimed"])
        self.assertNotIn("qualified_phase13_sha", SURFACE["authority"])
        self.assertNotIn("qualified_phase14_sha", SURFACE["authority"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
