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


def first_nonempty_option(page, selector: str) -> str:
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

            # Projects: create durable local state, add graph objects, link them and refresh.
            click_route(page, "projects", "#project-space")
            page.locator("#project-name").fill("Interactive contract project")
            page.locator("#project-goal").fill("Verify safe local browser controls execute intended actions")
            page.locator("#project-create-form button[type=submit]").click()
            page.locator("#project-controls").wait_for(state="visible")
            project_id = page.locator("#project-select").input_value()
            assert project_id
            checks.append("project_create")

            for object_type, title in [("task", "Button audit task"), ("source", "Button audit source")]:
                page.locator("#object-type").select_option(object_type)
                page.locator("#object-name").fill(title)
                page.locator("#object-source").fill("interactive-button-contract")
                page.locator("#object-form button[type=submit]").click()
                page.wait_for_function(
                    "expected => document.querySelectorAll('#project-graph .project-object').length >= expected",
                    arg=1 if object_type == "task" else 2,
                )
            checks.append("project_objects")

            edge_values = page.locator("#edge-from option").evaluate_all("options => options.map(option => option.value)")
            assert len(edge_values) >= 2
            page.locator("#edge-from").select_option(edge_values[0])
            page.locator("#edge-to").select_option(edge_values[1])
            page.locator("#edge-relation").fill("supports")
            page.locator("#edge-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#project-graph')?.innerText.includes('linked relation')")
            page.locator("#project-refresh").click()
            page.locator("#project-controls").wait_for(state="visible")
            checks.append("project_link_refresh")

            # Base and extended navigation must execute route handlers, not merely change text.
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
            click_route(page, "projects", "#project-space")
            checks.append("nav_projects")

            # The legacy Code entry is upgraded to the real Computer workspace.
            assert page.locator('.nav-item[data-route="computer"]').get_attribute("href") == "#/computer"
            assert page.locator('.nav-item[data-route="computer"] span:last-child').inner_text() == "Computer"
            checks.append("code_to_computer_upgrade")

            # Research: persist source + claim + exact citation, then exercise synchronized tabs.
            click_route(page, "research", "#research-space")
            if page.locator("#research-project").input_value() != project_id:
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
            checks.append("research_add_source")

            page.locator("#research-claim-text").fill("Axiom local interaction controls are exercised by this contract.")
            page.locator("#research-claim-uncertainty").fill("Browser-local test evidence only")
            page.locator("#research-claim-confidence").fill("0.9")
            page.locator("#research-claim-form button[type=submit]").click()
            page.wait_for_function("()=>[...document.querySelectorAll('#research-citation-claim option')].some(option => option.value)")
            checks.append("research_add_claim")

            page.locator("#research-citation-claim").select_option(first_nonempty_option(page, "#research-citation-claim"))
            page.locator("#research-citation-source").select_option(first_nonempty_option(page, "#research-citation-source"))
            page.locator("#research-citation-start").fill("0")
            page.locator("#research-citation-end").fill("5")
            page.locator("#research-citation-quote").fill("Axiom")
            page.locator("#research-citation-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelector('#research-report')?.innerText.includes('VERIFIED')")
            page.locator("#research-tab-map").click()
            assert page.locator("#research-map").is_visible()
            page.locator("#research-tab-timeline").click()
            assert page.locator("#research-timeline").is_visible()
            page.locator("#research-tab-report").click()
            checks.append("research_bind_citation_tabs")

            # Create: create, edit/version, diff, comment and export a browser-local artifact.
            click_route(page, "create", "#artifact-space")
            if page.locator("#artifact-project").input_value() != project_id:
                page.locator("#artifact-project").select_option(project_id)
            page.locator("#artifact-type").select_option("document")
            page.locator("#artifact-name").fill("Interactive control evidence")
            page.locator("#artifact-create-form button[type=submit]").click()
            page.locator("#artifact-editor").wait_for(state="visible")
            checks.append("artifact_create")

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
            checks.append("artifact_edit_diff_comment_export")

            # Live: exercise only non-media local controls; permissions are tested by route wiring below.
            click_route(page, "live", "#live-space")
            if page.locator("#live-project").input_value() != project_id:
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
            checks.append("live_local_session_controls")

            # Computer: deterministic srcdoc-only sandbox controls, including approval and rollback.
            click_route(page, "computer", "#computer-space")
            if page.locator("#computer-project").input_value() != project_id:
                page.locator("#computer-project").select_option(project_id)
            page.locator("#computer-fixture").select_option("safe")
            page.locator("#computer-start").click()
            page.wait_for_function("()=>!document.querySelector('#computer-state')?.innerText.includes('No session')")
            page.locator("#computer-pause").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('PAUSED')")
            page.locator("#computer-resume").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('ACTIVE')")
            page.locator("#computer-takeover").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('USER_TAKEOVER')")
            page.locator("#computer-release").click()
            page.wait_for_function("()=>document.querySelector('#computer-state')?.innerText.includes('ACTIVE')")
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
            checks.append("computer_local_control_cycle")

            # Agents: register an explicitly scoped agent and run an approval-bound local automation preview.
            click_route(page, "agents", "#agents-space")
            if page.locator("#agents-project").input_value() != project_id:
                page.locator("#agents-project").select_option(project_id)
            page.locator("#agent-name").fill("Interaction verifier")
            page.locator("#agent-purpose").fill("Run deterministic local interaction previews")
            page.locator("#agent-tools").select_option(["project.read"])
            page.locator("#agent-data").select_option(["project.metadata"])
            page.locator("#agent-create-form button[type=submit]").click()
            page.wait_for_function("()=>document.querySelectorAll('#agent-list .agent-record').length >= 1")
            checks.append("agent_register")

            page.locator("#automation-agent").select_option(first_nonempty_option(page, "#automation-agent"))
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
            checks.append("automation_approve_preview")

            # Observability: refresh and switch all three inspectable views over generated local runs.
            click_route(page, "observability", "#observability-space")
            page.locator("#obs-refresh").click()
            page.wait_for_function("()=>[...document.querySelectorAll('#obs-run-select option')].some(option => option.value)")
            page.locator("#obs-run-select").select_option(first_nonempty_option(page, "#obs-run-select"))
            for tab in ["developer", "operator", "user"]:
                page.locator(f'[data-obs-tab="{tab}"]').click()
                expected = {"developer": "#obs-developer-panel", "operator": "#obs-operator-panel", "user": "#obs-user-panel"}[tab]
                assert page.locator(expected).is_visible()
            checks.append("observability_refresh_tabs")

            # Operator: local organization/RBAC/policy preview only.
            click_route(page, "operator", "#operator-space")
            page.locator("#operator-org-form button[type=submit]").click()
            page.wait_for_function("()=>Boolean(document.querySelector('#operator-org')?.value)")
            org_id = page.locator("#operator-org").input_value()
            assert org_id
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
            checks.append("operator_local_policy_controls")

            # Developer: symbolic credential, static package, exact local install, conformance and no-delivery webhook.
            click_route(page, "developer", "#developer-platform-space")
            if page.locator("#developer-org").input_value() != org_id:
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
            checks.append("developer_local_platform_controls")

            # Evidence: exact claim boundary and downloadable local review package.
            click_route(page, "evidence", "#evidence-observatory-space")
            page.locator("#evidence-check-claim").click()
            page.wait_for_function("()=>document.querySelector('#evidence-claim-result')?.innerText.includes('authorized')")
            with page.expect_download() as evidence_download:
                page.locator("#evidence-export").click()
            assert evidence_download.value.suggested_filename.startswith("axiom-evidence-review-")
            checks.append("evidence_claim_export")

            # PWA resilience: cached project refresh + harmless local queue/replay + persistence request.
            click_route(page, "settings", "#pwa-native-space")
            page.locator("#pwa-refresh").click()
            page.wait_for_function("()=>document.querySelector('#pwa-project-state')?.innerText.includes('browser-local project')")
            page.locator("#pwa-queue-local").click()
            page.wait_for_function("()=>document.querySelector('#pwa-queue-state')?.innerText.includes('queued')")
            page.locator("#pwa-replay-local").click()
            page.wait_for_function("()=>document.querySelector('#pwa-queue-state')?.innerText.includes('completed locally')")
            page.locator("#pwa-storage").click()
            page.wait_for_function("()=>document.querySelector('#pwa-status')?.innerText !== 'Ready.'")
            checks.append("pwa_local_resilience_controls")

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
            "project_create",
            "project_objects",
            "project_link_refresh",
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
            "research_add_source",
            "research_add_claim",
            "research_bind_citation_tabs",
            "artifact_create",
            "artifact_edit_diff_comment_export",
            "live_local_session_controls",
            "computer_local_control_cycle",
            "agent_register",
            "automation_approve_preview",
            "observability_refresh_tabs",
            "operator_local_policy_controls",
            "developer_local_platform_controls",
            "evidence_claim_export",
            "pwa_local_resilience_controls",
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
            "schema": "musitu.axiom.browser-interaction-evidence.v2",
            "status": "PASS",
            "interactive_navigation_verified": True,
            "extended_workspace_bootstrap_verified": True,
            "workspace_action_controls_verified": True,
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
