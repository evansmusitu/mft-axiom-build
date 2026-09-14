from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parent
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
PWA = (ROOT / "pwa_runtime.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))
BROWSER_RUNNER = (ROOT / "tests/run_browser_application.py").read_text(encoding="utf-8")
PRODUCTION_WORKER = (REPOSITORY / "ops/axiom_browser_application_worker.mjs").read_text(encoding="utf-8")
PRODUCTION_DEPLOY = (REPOSITORY / "ops/axiom_browser_application_deploy.py").read_text(encoding="utf-8")
PRODUCTION_WORKFLOW = (REPOSITORY / ".github/workflows/axiom-browser-application-gate.yml").read_text(encoding="utf-8")
DEPLOY_SPEC = importlib.util.spec_from_file_location("axiom_browser_application_deploy", REPOSITORY / "ops/axiom_browser_application_deploy.py")
assert DEPLOY_SPEC and DEPLOY_SPEC.loader
DEPLOY = importlib.util.module_from_spec(DEPLOY_SPEC)
DEPLOY_SPEC.loader.exec_module(DEPLOY)


class BrowserApplicationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads((ROOT / "browser-app.json").read_text(encoding="utf-8"))
        cls.launch = (ROOT / "browser_app.js").read_text(encoding="utf-8")
        cls.session = (ROOT / "browser_session.js").read_text(encoding="utf-8")

    def test_canonical_entry_is_truthful_and_does_not_repurpose_api_edge(self):
        deployment = self.contract["deployment"]
        self.assertEqual(self.contract["schema"], "musitu.axiom.browser-application.v1")
        self.assertIn(self.contract["status"], {"PRODUCTION_DEPLOYMENT_CANDIDATE", "PRODUCTION_DEPLOYED_VERIFIED"})
        self.assertEqual(deployment["public_entry_url"], "https://app.mftintelligence.com/")
        self.assertEqual(deployment["integration_entry_url"], "https://app.mftintelligence.com/")
        self.assertEqual(deployment["production_app_origin"], "https://app.mftintelligence.com")
        self.assertEqual(deployment["exact_browser_entry_url"], "https://app.mftintelligence.com/#/home")
        self.assertEqual(deployment["canonical_app_path"], "/")
        self.assertEqual(deployment["default_route"], "#/home")
        self.assertEqual(deployment["entry_url"], "./#/home")
        self.assertEqual(deployment["origin_policy"], "DEDICATED_APPLICATION_ORIGIN")
        self.assertEqual(deployment["reserved_api_origin"], "https://axiom.mftintelligence.com")
        self.assertEqual(
            deployment["production_deployment_claimed"],
            self.contract["status"] == "PRODUCTION_DEPLOYED_VERIFIED",
        )

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
            "sign_in_path",
            "sign_out_path",
        ]:
            self.assertIn(token, self.session)
        for forbidden in ["localStorage.setItem('access_token", "localStorage.setItem('refresh_token", "Authorization: Bearer"]:
            self.assertNotIn(forbidden, self.session)
        self.assertIn('id="session-button"', HTML)
        self.assertIn('id="session-dialog"', HTML)
        self.assertIn('id="session-sign-in"', HTML)
        self.assertIn('id="session-sign-out"', HTML)
        self.assertIn("initBrowserSession", APP)

    def test_production_worker_is_path_isolated_and_account_session_is_server_side(self):
        for token in [
            "app.mftintelligence.com",
            "/.well-known/axiom-session",
            "/auth/start",
            "/auth/session",
            "/auth/sign-out",
            "__Host-axiom_session",
            "HttpOnly",
            "SameSite=${sameSite}",
            "setCookie(SESSION_COOKIE, sealed, SESSION_SECONDS, 'Lax')",
            "AXIOM_DB",
            "AUTH_RATE_LIMITER",
            "AXIOM_BROWSER_SESSION_SECRET",
            "env.ASSETS.fetch",
        ]:
            self.assertIn(token, PRODUCTION_WORKER)
        self.assertNotIn('"https://axiom.mftintelligence.com"', PRODUCTION_WORKER)
        self.assertNotRegex(PRODUCTION_WORKER, r"(?:access|refresh)[_-]?token")
        for token in [
            "needs:",
            "app.mftintelligence.com",
            "OPENAI_REVIEWER_ACCOUNT_KEY",
            "CLOUDFLARE_GLOBAL_API_KEY",
            "axiom-browser-application-production-deployment",
        ]:
            self.assertIn(token, PRODUCTION_WORKFLOW)
        for token in [
            "PUBLIC_ENTRY = f\"{APP_ORIGIN}/\"",
            "UNDEPLOYED_APEX_ROUTE_PATTERNS",
            "RESERVED_API_HOST = \"axiom.mftintelligence.com\"",
            "CONFIG_RULE_REF = \"musitu_axiom_browser_application_direct_browser_v1\"",
            "configuration_rule_migration_required",
            "apex_entry_bridge_deployed",
            "verify_identity",
        ]:
            self.assertIn(token, PRODUCTION_DEPLOY)

    def test_production_topology_preflight_rejects_origin_and_route_conflicts(self):
        reserved = {"id": "reserved-id", "hostname": DEPLOY.RESERVED_API_HOST, "service": "certified-api-edge", "zone_id": DEPLOY.ZONE_ID}
        configuration_ruleset = {"id": "configuration-ruleset-id", "phase": "http_config_settings", "kind": "zone"}
        topology = {
            "domains": [reserved],
            "routes": [],
            "dns": [],
            "configuration_ruleset": configuration_ruleset,
            "configuration_rules": [],
        }
        selected = DEPLOY.validate_target(topology)
        self.assertEqual(selected["app_domain"], [])
        self.assertEqual(selected["target_routes"], [])
        self.assertEqual(selected["application_configuration_rule"], [])
        self.assertEqual(selected["reserved_api_domain"][0]["service"], "certified-api-edge")
        self.assertEqual(selected["target_routes"], [])
        with self.assertRaisesRegex(RuntimeError, "DNS records"):
            DEPLOY.validate_target({**topology, "dns": [{"name": DEPLOY.APP_HOST, "type": "CNAME"}]})
        for pattern in DEPLOY.UNDEPLOYED_APEX_ROUTE_PATTERNS:
            with self.subTest(pattern=pattern), self.assertRaisesRegex(RuntimeError, "unclaimed AXIOM apex routes"):
                DEPLOY.validate_target({**topology, "routes": [{"pattern": pattern, "script": DEPLOY.SERVICE}]})
        unrelated_routes = [
            {"pattern": pattern, "script": "unrelated-apex-service"}
            for pattern in DEPLOY.UNDEPLOYED_APEX_ROUTE_PATTERNS
        ]
        self.assertEqual(DEPLOY.validate_target({**topology, "routes": unrelated_routes})["target_routes"], [])
        with self.assertRaisesRegex(RuntimeError, "reserved production API domain"):
            DEPLOY.validate_target({**topology, "domains": []})

    def test_production_browser_challenge_exception_is_exact_host_and_fail_closed_on_drift(self):
        reserved = {"id": "reserved-id", "hostname": DEPLOY.RESERVED_API_HOST, "service": "certified-api-edge"}
        configuration_ruleset = {"id": "configuration-ruleset-id", "phase": "http_config_settings", "kind": "zone"}
        exact_rule = {
            "id": "browser-rule-id",
            "ref": DEPLOY.CONFIG_RULE_REF,
            "action": "set_config",
            "action_parameters": {"security_level": "essentially_off", "bic": False},
            "expression": DEPLOY.CONFIG_RULE_EXPRESSION,
            "enabled": True,
        }
        topology = {
            "domains": [reserved],
            "routes": [],
            "dns": [],
            "configuration_ruleset": configuration_ruleset,
            "configuration_rules": [exact_rule],
        }
        selected = DEPLOY.validate_target(topology)
        self.assertEqual(selected["application_configuration_rule"][0]["id"], "browser-rule-id")
        self.assertFalse(selected["configuration_rule_migration_required"])
        self.assertEqual(DEPLOY.CONFIG_RULE_EXPRESSION, 'http.host eq "app.mftintelligence.com"')
        edge = self.contract["edge_security"]
        self.assertEqual(edge["global_zone_policy"], "PRESERVED")
        self.assertEqual(
            edge["browser_application_routes_configuration"]["scope"],
            "EXACT_APPLICATION_HOSTNAME_ONLY",
        )
        self.assertTrue(edge["worker_security_and_authentication_preserved"])
        with self.assertRaisesRegex(RuntimeError, "differs from the exact direct-browser contract"):
            DEPLOY.validate_target({
                **topology,
                "configuration_rules": [{**exact_rule, "action_parameters": {"security_level": "high", "bic": False}}],
            })
        with self.assertRaisesRegex(RuntimeError, "different configuration rule"):
            DEPLOY.validate_target({
                **topology,
                "configuration_rules": [{**exact_rule, "ref": "unrelated-rule"}],
            })
        legacy = DEPLOY.validate_target({
            **topology,
            "configuration_rules": [{**exact_rule, "expression": DEPLOY.LEGACY_APEX_CONFIG_RULE_EXPRESSION}],
        })
        self.assertTrue(legacy["configuration_rule_migration_required"])
        with self.assertRaisesRegex(RuntimeError, "different configuration rule"):
            DEPLOY.validate_target({
                **topology,
                "configuration_rules": [
                    exact_rule,
                    {
                        **exact_rule,
                        "id": "unrelated-legacy-rule-id",
                        "ref": "unrelated-legacy-rule",
                        "expression": DEPLOY.LEGACY_APEX_CONFIG_RULE_EXPRESSION,
                    },
                ],
            })
        with self.assertRaisesRegex(RuntimeError, "different configuration rule"):
            DEPLOY.validate_target({
                **topology,
                "configuration_rules": [{
                    **exact_rule,
                    "ref": "unrelated-legacy-rule",
                    "expression": DEPLOY.LEGACY_APEX_CONFIG_RULE_EXPRESSION,
                }],
            })
        with self.assertRaisesRegex(RuntimeError, "differs from the exact direct-browser contract"):
            DEPLOY.validate_target({
                **topology,
                "configuration_rules": [{**exact_rule, "expression": 'http.host eq "www.mftintelligence.com"'}],
            })
        for drift in (
            {"enabled": False},
            {"enabled": None},
            {"action_parameters": {"security_level": "essentially_off", "bic": False, "polish": "off"}},
        ):
            with self.subTest(drift=drift), self.assertRaisesRegex(
                RuntimeError, "differs from the exact direct-browser contract"
            ):
                DEPLOY.validate_target({**topology, "configuration_rules": [{**exact_rule, **drift}]})

    def test_configuration_rule_rollback_deletes_created_rule_by_ref(self):
        ruleset_id = "configuration-ruleset-id"
        rule_id = "browser-rule-id"
        client = mock.Mock()
        client.call.side_effect = [
            {"rules": [{"id": rule_id, "ref": DEPLOY.CONFIG_RULE_REF}]},
            {},
            {"rules": []},
        ]
        result = DEPLOY.delete_created(client, False, None, [], ruleset_id, True, None, None)
        self.assertTrue(result["configuration_rule_deleted"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            client.call.call_args_list[1],
            mock.call(f"/zones/{DEPLOY.ZONE_ID}/rulesets/{ruleset_id}/rules/{rule_id}", "DELETE"),
        )

    def test_configuration_rule_rollback_restores_legacy_scope_with_patch(self):
        ruleset_id = "configuration-ruleset-id"
        rule_id = "browser-rule-id"
        previous = {
            "id": rule_id,
            "ref": DEPLOY.CONFIG_RULE_REF,
            "action": "set_config",
            "action_parameters": {"security_level": "essentially_off", "bic": False},
            "expression": DEPLOY.LEGACY_APEX_CONFIG_RULE_EXPRESSION,
            "description": "legacy exact Axiom scope",
            "enabled": True,
        }
        client = mock.Mock()
        client.call.side_effect = [
            {},
            {"rules": [previous]},
        ]
        result = DEPLOY.delete_created(client, False, None, [], ruleset_id, False, None, previous)
        self.assertTrue(result["configuration_rule_restored"])
        self.assertEqual(result["errors"], [])
        update = client.call.call_args_list[0]
        self.assertEqual(update.args[0], f"/zones/{DEPLOY.ZONE_ID}/rulesets/{ruleset_id}/rules/{rule_id}")
        self.assertEqual(update.args[1], "PATCH")
        self.assertEqual(update.args[2]["expression"], DEPLOY.LEGACY_APEX_CONFIG_RULE_EXPRESSION)

    def test_custom_domain_rollback_discovers_a_committed_domain(self):
        client = mock.Mock()
        client.call.side_effect = [
            [{"id": "application-domain-id", "hostname": DEPLOY.APP_HOST, "service": DEPLOY.SERVICE}],
            {},
            [],
        ]
        result = DEPLOY.delete_created(
            client,
            True,
            None,
            [],
            "configuration-ruleset-id",
            False,
            None,
            None,
        )
        self.assertTrue(result["domain_deleted"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            client.call.call_args_list[1],
            mock.call(f"/accounts/{DEPLOY.ACCOUNT_ID}/workers/domains/application-domain-id", "DELETE"),
        )

    def test_production_preflight_preserves_failure_evidence_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preflight.json"
            with mock.patch.object(DEPLOY, "Cloudflare", side_effect=RuntimeError("credentials unavailable")):
                with self.assertRaisesRegex(RuntimeError, "credentials unavailable"):
                    DEPLOY.preflight(output, "0" * 40)
            failure = json.loads((output.parent / "preflight-failure.json").read_text(encoding="utf-8"))
            self.assertEqual(failure["status"], "FAIL")
            self.assertEqual(failure["source_git_sha"], "0" * 40)
            self.assertFalse(failure["write_performed"])
            self.assertFalse(output.exists())

    def test_production_readiness_retries_transient_dns_without_relaxing_health(self):
        expected = {
            "ok": True,
            "build_sha": "0" * 40,
            "app_origin": DEPLOY.APP_ORIGIN,
            "integration_entry": DEPLOY.PUBLIC_ENTRY,
            "reserved_api_origin_preserved": True,
            "normal_launch_download": False,
            "account_session_integration": True,
        }
        headers = {"x-axiom-browser-application": "production"}
        with (
            mock.patch.object(
                DEPLOY,
                "http",
                side_effect=[DEPLOY.urllib.error.URLError("dns not propagated"), (200, headers, json.dumps(expected).encode())],
            ) as request,
            mock.patch.object(DEPLOY.time, "sleep") as pause,
        ):
            self.assertEqual(DEPLOY.wait_for_application("0" * 40), expected)
        self.assertEqual(request.call_count, 2)
        pause.assert_called_once_with(2)

    def test_production_live_verifier_uses_browser_profile_and_safe_edge_signals(self):
        self.assertTrue(DEPLOY.BROWSER_USER_AGENT.startswith("Mozilla/5.0"))
        signal = DEPLOY.edge_failure_signal(
            403,
            {"content-type": "text/html", "server": "cloudflare", "cf-ray": "test-ray", "cf-mitigated": "challenge"},
            b"<!doctype html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x'></script>",
        )
        self.assertEqual(signal["http_status"], 403)
        self.assertTrue(signal["cf_ray_present"])
        self.assertTrue(signal["challenge_page"])
        self.assertNotIn("body", signal)

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
        self.assertIn("const CACHE='axiom-browser-application-production-candidate-v1'", SW)
        self.assertIn("const LEGACY_PHASE14_CACHE='axiom-interface-phase14-candidate-v1'", SW)
        for asset in ["./browser_app.js", "./browser_session.js", "./browser-app.json"]:
            self.assertIn(asset, SW)
        for token in ["/.well-known/axiom-session", "./auth/", "./health", "cache:'no-store'", "response.ok", "text/html"]:
            self.assertIn(token, SW)
        self.assertNotRegex(SW, r"SHELL\s*=\s*\[[^\]]*\.well-known/axiom-session")

    def test_candidate_truth_boundary_does_not_change_earned_phase_authority(self):
        browser = SURFACE["browser_application_substrate"]
        self.assertEqual(SURFACE["phase"], "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE")
        self.assertIn(browser["status"], {"PRODUCTION_DEPLOYMENT_CANDIDATE", "PRODUCTION_DEPLOYED_VERIFIED"})
        self.assertEqual(browser["origin_policy"], "DEDICATED_APPLICATION_ORIGIN")
        self.assertTrue(browser["browser_launch_implemented"])
        self.assertTrue(browser["authenticated_session_contract_implemented"])
        expected_claim = browser["status"] == "PRODUCTION_DEPLOYED_VERIFIED"
        self.assertEqual(browser["production_deployment_claimed"], expected_claim)
        self.assertEqual(browser["production_identity_integration_claimed"], expected_claim)
        self.assertNotIn("qualified_phase13_sha", SURFACE["authority"])
        self.assertNotIn("qualified_phase14_sha", SURFACE["authority"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
