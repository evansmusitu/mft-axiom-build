from __future__ import annotations
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("AXIOM_PHASE12_ARTIFACT_DIR", "/tmp/axiom-interface-phase12"))
OUT.mkdir(parents=True, exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main() -> None:
    handler = lambda *a, **k: Quiet(*a, directory=str(ROOT), **k)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=os.environ.get("AXIOM_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or None)
            context = browser.new_context(viewport={"width": 1440, "height": 1200}, reduced_motion="reduce")
            page = context.new_page()
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url))
            page.goto(origin + "/index.html#/developer", wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomDeveloperPlatformBootstrap)")
            page.evaluate("()=>window.AxiomDeveloperPlatformBootstrap")
            page.evaluate("()=>window.AxiomOperator.store.bootstrapOrganization({orgId:'phase12-org',name:'Phase 12 Local Enterprise'})")
            page.evaluate("()=>window.AxiomDeveloperPlatform.selectOrganization('phase12-org')")
            page.locator("#developer-platform-space").wait_for(state="visible")
            page.locator("#developer-credential-form").get_by_role("button", name="Register symbolic handle").click()
            page.wait_for_timeout(100)
            credential = page.evaluate("()=>window.AxiomDeveloperPlatform.store.listCredentialHandles('phase12-org').then(rows=>rows[0])")
            assert credential["plaintext_secret_present"] is False and credential["production_credential_issued"] is False
            secret_rejected = page.evaluate("()=>window.AxiomDeveloperPlatform.store.registerCredentialHandle('phase12-org','local-user',{label:'api_key=sk_deadbeefdeadbeef',scopes:['sdk.invoke']}).then(()=> 'ALLOWED').catch(error=>error.name)")
            assert secret_rejected == "SecurityError", secret_rejected
            page.locator("#developer-package-form").get_by_role("button", name="Validate & register package").click()
            page.wait_for_timeout(120)
            package_id = page.locator("#developer-package").input_value()
            assert package_id == "musitu.local.analysis-template", package_id
            escalation = page.evaluate("id=>window.AxiomDeveloperPlatform.store.prepareInstall('phase12-org','local-user',id,['analysis.read','analysis.execute','audit.read']).then(()=> 'ALLOWED').catch(error=>error.name)", package_id)
            assert escalation == "ALLOWED"
            preview = page.evaluate("id=>window.AxiomDeveloperPlatform.store.prepareInstall('phase12-org','local-user',id,['analysis.read'])", package_id)
            stale = page.evaluate("id=>window.AxiomDeveloperPlatform.store.applyInstall('phase12-org','local-user',id,['analysis.read'],'0'.repeat(64)).then(()=> 'ALLOWED').catch(error=>error.name)", package_id)
            assert stale == "SecurityError", stale
            install = page.evaluate("args=>window.AxiomDeveloperPlatform.store.applyInstall('phase12-org','local-user',args.id,['analysis.read'],args.sha)", {"id": package_id, "sha": preview["preview_sha256"]})
            assert install["execution_enabled"] is False and install["external_code_executed"] is False
            hook = page.evaluate("()=>window.AxiomDeveloperPlatform.store.declareWebhook('phase12-org','local-user',{label:'Audit preview',endpoint:'https://example.test/axiom-events',events:['package.installed']})")
            fixture = page.evaluate("id=>window.AxiomDeveloperPlatform.store.previewWebhookEvent('phase12-org','local-user',id,'package.installed',{package_id:'musitu.local.analysis-template'})", hook["webhook_id"])
            assert fixture["payload"]["delivery_enabled"] is False and len(fixture["payload"]["fixture_signature_sha256"]) == 64
            result = page.evaluate("id=>window.AxiomDeveloperPlatform.store.conformance('phase12-org','local-user',id)", package_id)
            assert result["status"] == "PASS", result
            assert result["least_privilege_verified"] is True and result["isolation_verified"] is True
            assert result["production_api_key_issued"] is False and result["remote_mcp_binding_claimed"] is False
            assert result["outbound_webhook_delivery_claimed"] is False and result["untrusted_package_code_executed"] is False
            bundle = page.evaluate("args=>window.AxiomDeveloperPlatform.store.sdkBundle('phase12-org','local-user',args.packageId,args.handle)", {"packageId": package_id, "handle": credential["credential_handle"]})
            assert bundle["mcp"]["protocol"] == "2026-07-28" and bundle["mcp"]["remote_binding"] is False
            assert bundle["a2a"]["external_endpoint"] is None
            integrity = page.evaluate("()=>window.AxiomDeveloperPlatform.store.verify('phase12-org')")
            assert integrity["status"] == "PASS", integrity
            page.reload(wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomDeveloperPlatformBootstrap)")
            page.evaluate("()=>window.AxiomDeveloperPlatformBootstrap")
            persisted = page.evaluate("()=>window.AxiomDeveloperPlatform.store.listPackages('phase12-org')")
            assert len(persisted) == 1 and persisted[0]["package_id"] == package_id
            page.locator("#developer-platform-space").wait_for(state="visible")
            assert page.locator("#observability-space").is_hidden()
            page.keyboard.press("Control+K")
            assert page.locator("#composer-input").evaluate("el=>el===document.activeElement")
            page.screenshot(path=str(OUT / "phase12-developer-marketplace.png"), full_page=True)
            foreign = [url for url in requests if not url.startswith(origin + "/")]
            assert foreign == [], foreign
            evidence = {
                "schema": "musitu.axiom.interface.phase12-developer-browser-evidence.v1",
                "status": "PASS",
                "org_id": "phase12-org",
                "package_id": package_id,
                "symbolic_credential_only_verified": True,
                "secret_like_material_rejected": True,
                "exact_install_digest_verified": True,
                "stale_install_digest_rejected": True,
                "least_privilege_verified": True,
                "mcp_2026_local_descriptor_verified": True,
                "a2a_local_card_verified": True,
                "webhook_signed_fixture_no_delivery_verified": True,
                "untrusted_code_nonexecution_verified": True,
                "cross_reload_persistence_verified": True,
                "route_ownership_verified": True,
                "ctrl_k_inherited_focus_verified": True,
                "integrity_verified": True,
                "foreign_requests": foreign,
                "network_policy": "DENY_ALL_EXTERNAL_NETWORK",
                "platform_mode": "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY",
                "production_api_key_issued": False,
                "remote_mcp_binding_claimed": False,
                "outbound_webhook_delivery_claimed": False,
                "untrusted_package_code_executed": False,
                "external_conformance_certification_claimed": False,
            }
            (OUT / "phase12-developer-browser-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_INTERFACE_PHASE12_DEVELOPER_BROWSER_PASS")


if __name__ == "__main__":
    main()
