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


def route(page, name: str, visible: str) -> None:
    link = page.locator(f'.nav-item[data-route="{name}"]')
    assert link.count() == 1, name
    link.click()
    wait_hash(page, f"#/{name}")
    page.locator(visible).wait_for(state="visible")


def first_value(page, selector: str) -> str:
    value = page.locator(f"{selector} option").evaluate_all(
        "options => options.map(option => option.value).find(Boolean) || ''"
    )
    assert value, selector
    return value


def main() -> None:
    AppHandler.request_paths = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    checks: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1440, "height": 1000},
                reduced_motion="reduce",
                accept_downloads=True,
            )
            page = context.new_page()
            response = page.goto(origin + "/#/home", wait_until="domcontentloaded")
            assert response is not None and response.ok
            page.wait_for_function("()=>Boolean(window.AxiomBrowserApplication)")
            page.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            page.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            page.wait_for_function(
                "()=>Boolean(window.AxiomComputer && window.AxiomAgents && window.AxiomEvidenceObservatory && window.AxiomDeveloperPlatform && window.AxiomPwaHardening)"
            )
            checks.append("extended_workspace_bootstrap")

            route(page, "projects", "#project-space")
            page.locator("#project-name").fill("Interactive contract project")
            page.locator("#project-goal").fill("Verify safe local browser controls execute intended actions")
            page.locator("#project-create-form button[type=submit]").click()
            page.locator("#project-controls").wait_for(state="visible")
            project_id = page.locator("#project-select").input_value()
            assert project_id
            checks.append("project_create")

            for expected, (object_type, title) in enumerate((("task", "Button audit task"), ("source", "Button audit source")), start=1):
                page.locator("#object-type").select_option(object_type)
                page.locator("#object-name").fill(title)
                page.locator("#object-source").fill("interactive-button-contract")
                page.locator("#object-form button[type=submit]").click()
                page.wait_for_function(
                    "count => document.querySelectorAll('#project-graph .project-object').length >= count",
                    arg=expected,
                )
            edge_values = page.locator("#edge-from option").evaluate_all("options => options.map(option => option.value)")
            assert len(edge_values) >= 2
            page.locator("#edge-from").select_option(edge_values[0])
            page.locator("#edge-to").select_option(edge_values[1])
            page.locator("#edge-relation").fill("supports")
            page.locator("#edge-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#project-graph')?.innerText.includes('linked relation')")
            page.locator("#project-refresh").click()
            page.locator("#project-controls").wait_for(state="visible")
            checks.append("project_graph_controls")

            for name, selector in (
                ("research", "#research-space"),
                ("create", "#artifact-space"),
                ("live", "#live-space"),
                ("computer", "#computer-space"),
                ("agents", "#agents-space"),
                ("evidence", "#evidence-observatory-space"),
                ("observability", "#observability-space"),
                ("developer", "#developer-platform-space"),
                ("settings", "#pwa-native-space"),
                ("projects", "#project-space"),
            ):
                route(page, name, selector)
                checks.append(f"nav_{name}")
            assert page.locator('.nav-item[data-route="computer"]').get_attribute("href") == "#/computer"
            checks.append("computer_nav_upgrade")

            route(page, "research", "#research-space")
            page.locator("#research-project").select_option(project_id)
            page.locator("#research-source-title").fill("Interactive evidence")
            page.locator("#research-source-url").fill("https://example.com/evidence")
            page.locator("#research-source-type").select_option("web")
            page.locator("#research-source-class").select_option("web")
            page.locator("#research-source-asof").fill("2026-09-14T12:00")
            page.locator("#research-source-retrieved").fill("2026-09-14T12:01")
            page.locator("#research-source-text").fill("Axiom evidence for local interaction verification.")
            page.locator("#research-source-form button[type=submit]").click()
            page.wait_for_function("()=>[...document.querySelectorAll('#research-citation-source option')].some(option => option.value)")
            page.locator("#research-claim-text").fill("Axiom local interaction controls are exercised by this contract.")
            page.locator("#research-claim-confidence").fill("0.9")
            page.locator("#research-claim-form button[type=submit]").click()
            page.wait_for_function("()=>[...document.querySelectorAll('#research-citation-claim option')].some(option => option.value)")
            page.locator("#research-citation-claim").select_option(first_value(page, "#research-citation-claim"))
            page.locator("#research-citation-source").select_option(first_value(page, "#research-citation-source"))
            page.locator("#research-citation-start").fill("0")
            page.locator("#research-citation-end").fill("5")
            page.locator("#research-citation-quote").fill("Axiom")
            page.locator("#research-citation-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#research-report')?.innerText.includes('VERIFIED')")
            for tab, panel in (("map", "#research-map"), ("timeline", "#research-timeline"), ("report", "#research-report")):
                page.locator(f"#research-tab-{tab}").click()
                assert page.locator(panel).is_visible()
            checks.append("research_controls")

            route(page, "create", "#artifact-space")
            page.locator("#artifact-project").select_option(project_id)
            page.locator("#artifact-type").select_option("document")
            page.locator("#artifact-name").fill("Interactive control evidence")
            page.locator("#artifact-create-form button[type=submit]").click()
            page.locator("#artifact-editor").wait_for(state="visible")
            page.locator("#artifact-edit-content").fill(json.dumps({"blocks": [{"type": "paragraph", "text": "Version two"}]}))
            page.locator("#artifact-save").click()
            page.wait_for_function("()=>document.querySelector('#artifact-editor-id')?.innerText.includes('current v1')")
            page.locator("#artifact-diff").click()
            page.wait_for_function("()=>document.querySelector('#artifact-diff-output')?.innerText.includes('change_count')")
            page.locator("#artifact-comment-text").fill("Button contract comment")
            page.locator("#artifact-comment-add").click()
            page.wait_for_function("()=>document.querySelector('#artifact-comments')?.innerText.includes('Button contract comment')")
            with page.expect_download() as artifact_download:
                page.locator("#artifact-export").click()
            assert artifact_download.value.suggested_filename.endswith("-artifact-export.json")
            checks.append("artifact_controls")

            route(page, "live", "#live-space")
            page.locator("#live-project").select_option(project_id)
            page.locator("#live-start").click()
            page.wait_for_function("()=>document.querySelector('#live-session-state')?.innerText.includes('ACTIVE')")
            page.locator("#live-note").fill("Local live note")
            page.locator("#live-note-save").click()
            page.wait_for_function("()=>document.querySelector('#live-note-status')?.innerText.includes('Saved')")
            page.locator("#live-transcript-text").fill("Manual local transcript turn")
            page.locator("#live-transcript-save").click()
            page.wait_for_function("()=>document.querySelector('#live-transcript')?.innerText.includes('Manual local transcript turn')")
            page.locator("#live-end").click()
            page.wait_for_function("()=>document.querySelector('#live-session-state')?.innerText.includes('ENDED')")
            checks.append("live_controls")

            route(page, "computer", "#computer-space")
            page.locator("#computer-project").select_option(project_id)
            page.locator("#computer-fixture").select_option("safe")
            page.locator("#computer-start").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('ACTIVE')")
            page.locator("#computer-pause").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('PAUSED')")
            page.locator("#computer-resume").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('ACTIVE')")
            page.locator("#computer-takeover").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('USER TAKEOVER')")
            page.locator("#computer-release").click()
            page.wait_for_function("()=>!document.querySelector('#computer-state')?.innerText.includes('USER TAKEOVER')")
            page.locator("#computer-action-type").select_option("type")
            page.locator("#computer-action-target").fill("#name")
            page.locator("#computer-action-value").fill("Ada")
            page.locator("#computer-action-form button[type=submit]").click()
            page.wait_for_function("()=>!document.querySelector('#computer-approve')?.disabled")
            page.locator("#computer-approve").click()
            page.wait_for_function("()=>!document.querySelector('#computer-execute')?.disabled")
            page.locator("#computer-execute").click()
            page.wait_for_function("()=>!document.querySelector('#computer-rollback')?.disabled")
            page.locator("#computer-rollback").click()
            page.locator("#computer-stop").click()
            checks.append("computer_controls")

            route(page, "agents", "#agents-space")
            page.locator("#agents-project").select_option(project_id)
            page.locator("#agent-name").fill("Interaction verifier")
            page.locator("#agent-purpose").fill("Run deterministic local interaction previews")
            page.locator("#agent-tools").select_option(["project.read"])
            page.locator("#agent-data").select_option(["project.metadata"])
            page.locator("#agent-create-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#agent-list')?.innerText.includes('Interaction verifier')")
            page.locator("#automation-agent").select_option(first_value(page, "#automation-agent"))
            page.locator("#automation-name").fill("Interaction preview")
            page.locator("#automation-objective").fill("Verify approval-bound local automation")
            page.locator("#automation-trigger-kind").select_option("schedule")
            page.locator("#automation-trigger-value").fill("30")
            page.locator("#automation-action").select_option("project.read")
            page.locator("#automation-create-form button[type=submit]").click()
            page.locator("[data-approve-automation]").wait_for(state="visible")
            page.locator("[data-approve-automation]").click()
            page.locator("[data-preview-automation]").wait_for(state="visible")
            page.locator("[data-preview-automation]").click()
            page.wait_for_function("()=>document.querySelector('#agents-status')?.innerText.includes('Local preview complete')")
            page.locator("#agents-refresh").click()
            checks.append("agent_automation_controls")

            route(page, "observability", "#observability-space")
            page.locator("#obs-refresh").click()
            page.wait_for_function("()=>[...document.querySelectorAll('#obs-run-select option')].some(option => option.value)")
            page.locator("#obs-run-select").select_option(first_value(page, "#obs-run-select"))
            for tab, panel in (("developer", "#obs-developer-panel"), ("operator", "#obs-operator-panel"), ("user", "#obs-user-panel")):
                page.locator(f'[data-obs-tab="{tab}"]').click()
                assert page.locator(panel).is_visible()
            checks.append("observability_controls")

            route(page, "operator", "#operator-space")
            page.locator("#operator-org-form button[type=submit]").click()
            page.wait_for_function("()=>Boolean(document.querySelector('#operator-org')?.value)")
            org_id = page.locator("#operator-org").input_value()
            page.locator("#operator-member-id").fill("interaction-reviewer")
            page.locator("#operator-member-role").select_option("viewer")
            page.locator("#operator-member-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#operator-members')?.innerText.includes('interaction-reviewer')")
            page.locator("#operator-project").select_option(project_id)
            page.locator("#operator-policy-form button[type=submit]").click()
            page.wait_for_function("()=>!document.querySelector('#operator-policy-apply')?.disabled")
            page.locator("#operator-policy-apply").click()
            page.wait_for_function("()=>document.querySelector('#operator-policy-preview')?.innerText.includes('Applied local policy SHA-256')")
            page.locator("#operator-refresh").click()
            checks.append("operator_controls")

            route(page, "developer", "#developer-platform-space")
            page.locator("#developer-org").select_option(org_id)
            page.locator("#developer-credential-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#developer-credentials')?.innerText.includes('Local SDK preview')")
            page.locator("#developer-package-form button[type=submit]").click()
            page.wait_for_function("()=>Boolean(document.querySelector('#developer-package')?.value)")
            page.locator("#developer-install-preview").click()
            page.wait_for_function("()=>!document.querySelector('#developer-install-apply')?.disabled")
            page.locator("#developer-install-apply").click()
            page.wait_for_function("()=>document.querySelector('#developer-install-digest')?.innerText.includes('Installed locally')")
            page.locator("#developer-conformance").click()
            page.wait_for_function("()=>document.querySelector('#developer-conformance-result')?.innerText.includes('status')")
            page.locator("#developer-webhook-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#developer-webhooks')?.innerText.includes('Audit preview')")
            checks.append("developer_controls")

            route(page, "evidence", "#evidence-observatory-space")
            page.locator("#evidence-check-claim").click()
            page.wait_for_function("()=>document.querySelector('#evidence-claim-result')?.innerText.includes('authorized')")
            with page.expect_download() as evidence_download:
                page.locator("#evidence-export").click()
            assert evidence_download.value.suggested_filename.startswith("axiom-evidence-review-")
            checks.append("evidence_controls")

            route(page, "settings", "#pwa-native-space")
            page.locator("#pwa-refresh").click()
            page.wait_for_function("()=>document.querySelector('#pwa-project-state')?.innerText.includes('browser-local project')")
            page.locator("#pwa-queue-local").click()
            page.wait_for_function("()=>document.querySelector('#pwa-queue-state')?.innerText.includes('queued')")
            page.locator("#pwa-replay-local").click()
            page.wait_for_function("()=>document.querySelector('#pwa-queue-state')?.innerText.includes('completed locally')")
            page.locator("#pwa-storage").click()
            checks.append("pwa_controls")

            page.goto(origin + "/#/home", wait_until="domcontentloaded")
            page.wait_for_function("()=>Boolean(window.AxiomPwaHardening)")
            page.get_by_role("button", name="Attach file or folder").click()
            wait_hash(page, "#/research")
            page.wait_for_function("()=>document.activeElement?.id === 'research-source-text'")
            page.get_by_role("button", name="Connect source or app").click()
            wait_hash(page, "#/research")
            page.wait_for_function("()=>document.activeElement?.id === 'research-source-url'")
            for label, tool in (("Use voice input", "voice"), ("Use camera", "camera"), ("Share screen", "screen")):
                page.get_by_role("button", name=label).click()
                wait_hash(page, "#/live")
                page.locator("#live-space").wait_for(state="visible")
                assert page.locator(f'[data-permission="{tool}"]').count() == 1
            checks.append("composer_tool_routes")

            page.goto(origin + "/#/home", wait_until="domcontentloaded")
            page.wait_for_function("()=>Boolean(window.AxiomBrowserApplication)")
            before_theme = page.locator("html").get_attribute("data-theme")
            page.locator("#theme-button").click()
            page.wait_for_function("before => document.documentElement.dataset.theme !== before", arg=before_theme)
            page.locator("#shortcuts-button").click()
            assert page.locator("#shortcuts-dialog").evaluate("el => el.open") is True
            page.locator("[data-close-dialog]").click()
            page.get_by_role("button", name="Build").click()
            assert page.get_by_role("button", name="Build").get_attribute("aria-pressed") == "true"
            page.locator("#composer-input").fill("Verify browser controls execute their intended local UI actions")
            page.locator("#preview-button").click()
            page.wait_for_function("()=>document.querySelector('#progress-value')?.textContent==='100%'")
            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#proof-mobile-button").click()
            page.wait_for_function("()=>document.querySelector('#proof-drawer')?.classList.contains('open')")
            page.locator("#tab-claims").click()
            assert page.locator("#tab-claims").get_attribute("aria-selected") == "true"
            page.locator("#proof-close-button").click()
            checks.append("shell_controls")

            page.screenshot(path=str(OUT / "interactive-buttons-mobile.png"), full_page=True)
            context.close()
            browser.close()

        evidence = {
            "schema": "musitu.axiom.browser-interaction-evidence.v2",
            "status": "PASS",
            "interactive_navigation_verified": True,
            "extended_workspace_bootstrap_verified": True,
            "workspace_action_controls_verified": True,
            "composer_tool_routing_verified": True,
            "mobile_controls_verified": True,
            "media_permission_prompt_triggered": False,
            "external_action_executed": False,
            "checks": checks,
            "request_paths": AppHandler.request_paths,
            "screenshot": "interactive-buttons-mobile.png",
        }
        (OUT / "interactive-button-evidence.json").write_text(
            json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_BROWSER_INTERACTIVE_BUTTON_CONTRACT_PASS")


if __name__ == "__main__":
    main()
