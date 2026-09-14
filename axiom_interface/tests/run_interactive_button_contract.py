from __future__ import annotations

from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

from run_browser_application import AppHandler


OUT = Path(os.environ.get("AXIOM_BROWSER_INTERACTION_ARTIFACT_DIR", "/tmp/axiom-browser-interactions"))
OUT.mkdir(parents=True, exist_ok=True)


def wait_hash(page, route: str) -> None:
    page.wait_for_function("route => location.hash === route", arg=route)


def click_route(page, route: str, selector: str | None = None) -> None:
    link = page.locator(f'.nav-item[data-route="{route}"]')
    assert link.count() == 1, route
    link.click()
    wait_hash(page, f"#/{route}")
    if selector:
        page.locator(selector).wait_for(state="visible")


def main() -> None:
    AppHandler.request_paths = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    checks: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce", accept_downloads=False)
            page = context.new_page()
            response = page.goto(origin + "/#/home", wait_until="domcontentloaded")
            assert response is not None and response.ok
            page.wait_for_function("()=>Boolean(window.AxiomBrowserApplication)")
            page.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            page.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            page.wait_for_function("()=>Boolean(window.AxiomComputer && window.AxiomAgents && window.AxiomEvidenceObservatory && window.AxiomDeveloperPlatform && window.AxiomPwaHardening)")
            checks.append("extended_workspace_bootstrap")

            # Base and extended navigation must execute route handlers, not merely change text.
            click_route(page, "projects", "#project-space")
            checks.append("nav_projects")
            click_route(page, "research", "#research-space")
            checks.append("nav_research")
            click_route(page, "create", "#artifact-space")
            checks.append("nav_create")
            click_route(page, "live", "#live-space")
            checks.append("nav_live")
            click_route(page, "computer", "#computer-space")
            checks.append("nav_computer")
            click_route(page, "agents", "#agents-space")
            checks.append("nav_agents")
            click_route(page, "evidence", "#evidence-observatory-space")
            checks.append("nav_evidence")
            click_route(page, "observability", "#observability-space")
            checks.append("nav_observability")
            click_route(page, "developer", "#developer-platform-space")
            checks.append("nav_developer")
            click_route(page, "settings", "#pwa-native-space")
            checks.append("nav_settings")

            # The legacy Code entry is upgraded to the real Computer workspace.
            assert page.locator('.nav-item[data-route="computer"]').get_attribute("href") == "#/computer"
            assert page.locator('.nav-item[data-route="computer"] span:last-child').inner_text() == "Computer"
            checks.append("code_to_computer_upgrade")

            # Composer tools must route to a usable destination instead of emitting surface-only telemetry.
            page.get_by_role("button", name="Attach file or folder").click()
            wait_hash(page, "#/research")
            page.wait_for_function("()=>document.activeElement?.id === 'research-source-text'")
            checks.append("composer_attach")

            page.get_by_role("button", name="Connect source or app").click()
            wait_hash(page, "#/research")
            page.wait_for_function("()=>document.activeElement?.id === 'research-source-url'")
            checks.append("composer_source")

            # Media tools open the permission-controlled Live surface. Do not trigger browser permissions in this gate.
            for label, tool in [("Use voice input", "voice"), ("Use camera", "camera"), ("Share screen", "screen")]:
                page.get_by_role("button", name=label).click()
                wait_hash(page, "#/live")
                live = page.locator("#live-space")
                live.wait_for(state="visible")
                assert live.is_visible()
                assert page.locator("#live-start").count() == 1
                permission = page.locator(f'[data-permission="{tool}"]')
                assert permission.count() == 1
                assert permission.get_attribute("type") == "button"
                checks.append(f"composer_{tool}")

            # Core shell buttons: theme, shortcuts, proof drawer, verbs and preview.
            page.goto(origin + "/#/home", wait_until="domcontentloaded")
            page.wait_for_function("()=>Boolean(window.AxiomBrowserApplication)")
            before_theme = page.locator("html").get_attribute("data-theme")
            page.locator("#theme-button").click()
            page.wait_for_function("before => document.documentElement.dataset.theme !== before", arg=before_theme)
            checks.append("theme_button")

            page.locator("#shortcuts-button").click()
            assert page.locator("#shortcuts-dialog").evaluate("el => el.open") is True
            page.locator("[data-close-dialog]").click()
            assert page.locator("#shortcuts-dialog").evaluate("el => el.open") is False
            checks.append("shortcuts_dialog")

            page.get_by_role("button", name="Build").click()
            assert page.get_by_role("button", name="Build").get_attribute("aria-pressed") == "true"
            checks.append("composer_verb")

            page.locator("#composer-input").fill("Verify that interactive browser controls execute their intended local UI actions")
            page.locator("#preview-button").click()
            page.wait_for_function("()=>document.querySelector('#progress-value')?.textContent==='100%'")
            assert "Build:" in page.locator("[data-preview-title]").inner_text()
            checks.append("preview_plan")

            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#proof-mobile-button").click()
            page.wait_for_function("()=>document.querySelector('#proof-drawer')?.classList.contains('open')")
            page.locator("#tab-claims").click()
            assert page.locator("#tab-claims").get_attribute("aria-selected") == "true"
            page.locator("#proof-close-button").click()
            page.wait_for_function("()=>!document.querySelector('#proof-drawer')?.classList.contains('open')")
            checks.append("mobile_proof_drawer")

            page.screenshot(path=str(OUT / "interactive-buttons-mobile.png"), full_page=True)
            context.close()
            browser.close()

        expected = {
            "extended_workspace_bootstrap",
            "nav_projects",
            "nav_research",
            "nav_create",
            "nav_live",
            "nav_computer",
            "nav_agents",
            "nav_evidence",
            "nav_observability",
            "nav_developer",
            "nav_settings",
            "code_to_computer_upgrade",
            "composer_attach",
            "composer_source",
            "composer_voice",
            "composer_camera",
            "composer_screen",
            "theme_button",
            "shortcuts_dialog",
            "composer_verb",
            "preview_plan",
            "mobile_proof_drawer",
        }
        assert set(checks) == expected, sorted(expected - set(checks))
        evidence = {
            "schema": "musitu.axiom.browser-interaction-evidence.v1",
            "status": "PASS",
            "interactive_navigation_verified": True,
            "extended_workspace_bootstrap_verified": True,
            "composer_tool_routing_verified": True,
            "composer_media_routes_verified": True,
            "mobile_controls_verified": True,
            "media_permission_prompt_triggered": False,
            "external_action_executed": False,
            "checks": checks,
            "request_paths": AppHandler.request_paths,
            "screenshot": "interactive-buttons-mobile.png",
        }
        (OUT / "interactive-button-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_BROWSER_INTERACTIVE_BUTTON_CONTRACT_PASS")


if __name__ == "__main__":
    main()
