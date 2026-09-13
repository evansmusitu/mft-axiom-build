from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = Path(os.environ.get("AXIOM_PHASE9_ARTIFACT_DIR", "/tmp/axiom-interface-phase9"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main() -> None:
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=os.environ.get("AXIOM_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or None,
            )
            context = browser.new_context(viewport={"width": 1440, "height": 1100}, reduced_motion="reduce")
            page = context.new_page()
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url))

            page.goto(origin + "/index.html#/projects", wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomAgentsBootstrap)")
            page.evaluate("()=>window.AxiomAgentsBootstrap")
            page.locator("#project-create-form").wait_for(state="visible")
            page.locator("#project-name").fill("Phase 9 Agent Governance Proof")
            page.locator("#project-goal").fill("Prove persistent least-privilege agents, approval-bound automations and cascading kill control")
            page.get_by_role("button", name="Create project").click()
            page.wait_for_timeout(120)
            project_id = page.locator("#project-select").input_value()
            assert project_id.startswith("prj_")

            page.goto(origin + "/index.html#/agents", wait_until="networkidle")
            page.locator("#agents-space").wait_for(state="visible")
            expect(page.locator("#agents-title")).to_have_text("Agents & automations")
            expect(page.locator('[data-route="automations"]')).to_be_visible()
            assert page.locator(".hero-card").is_hidden()
            assert page.locator(".run-stage").is_hidden()
            page.locator("#agents-project").select_option(project_id)
            page.wait_for_timeout(80)

            page.locator("#agent-name").fill("Research coordinator")
            page.locator("#agent-purpose").fill("Coordinate bounded local project research previews")
            page.locator("#agent-tools").select_option(["project.read", "research.read", "agent.delegate"])
            page.locator("#agent-data").select_option(["project.metadata", "project.sources"])
            page.locator("#agent-autonomy").select_option("LOCAL_PREVIEW")
            page.locator("#agent-max-runs").fill("4")
            page.locator("#agent-max-compute").fill("4")
            page.get_by_role("button", name="Register agent").click()
            page.wait_for_timeout(120)
            agents = page.evaluate("id=>window.AxiomAgents.store.listAgents(id)", project_id)
            assert len(agents) == 1
            root = agents[0]
            assert root["workload_identity_id"].startswith("workload:agent_")
            assert root["grant"]["network_policy"] == "DENY_ALL_EXTERNAL_NETWORK"
            assert root["grant"]["secrets_policy"] == "SYMBOLIC_REFERENCE_ONLY_NO_PLAINTEXT_SECRETS"

            page.locator("#delegate-parent").select_option(root["agent_id"])
            page.locator("#delegate-name").fill("Source reader")
            page.locator("#delegate-purpose").fill("Read only the approved project source scope")
            page.locator("#delegate-tools").select_option(["project.read"])
            page.locator("#delegate-data").select_option(["project.sources"])
            page.locator("#delegate-autonomy").select_option("PROPOSE_ONLY")
            page.locator("#delegate-max-runs").fill("2")
            page.locator("#delegate-max-compute").fill("2")
            page.get_by_role("button", name="Create delegated agent").click()
            page.wait_for_timeout(120)
            agents = page.evaluate("id=>window.AxiomAgents.store.listAgents(id)", project_id)
            assert len(agents) == 2
            child = next(agent for agent in agents if agent["parent_agent_id"] == root["agent_id"])
            assert child["delegation_depth"] == 1
            assert child["grant"]["tool_scopes"] == ["project.read"]

            escalation = page.evaluate(
                """async ({parent})=>{try{await window.AxiomAgents.store.delegateAgent(parent,{name:'Escalation',purpose:'Must fail',toolScopes:['artifact.write'],dataScopes:['project.sources'],autonomy:'PROPOSE_ONLY',maxRuns:1,maxComputeUnits:1});return 'ALLOWED'}catch(error){return error.name}}""",
                {"parent": root["agent_id"]},
            )
            foreign_owner = page.evaluate(
                """async project=>{try{await window.AxiomAgents.store.createAgent({projectId:project,actorId:'viewer-1',name:'Foreign',purpose:'Must fail',toolScopes:['project.read'],dataScopes:['project.metadata']});return 'ALLOWED'}catch(error){return error.name}}""",
                project_id,
            )
            assert escalation == "SecurityError"
            assert foreign_owner == "NotAllowedError"

            page.locator("#automation-agent").select_option(child["agent_id"])
            page.locator("#automation-name").fill("Read sources on project update")
            page.locator("#automation-objective").fill("Create a local evidence preview after an approved project update event")
            page.locator("#automation-trigger-kind").select_option("event")
            page.locator("#automation-trigger-value").fill("project.updated")
            page.locator("#automation-action").select_option("project.read")
            page.get_by_role("button", name="Create approval-bound draft").click()
            page.wait_for_timeout(120)
            automations = page.evaluate("id=>window.AxiomAgents.store.listAutomations(id)", project_id)
            assert len(automations) == 1 and automations[0]["status"] == "DRAFT"
            automation = automations[0]

            stale = page.evaluate(
                """async id=>{try{await window.AxiomAgents.store.approveAutomation(id,'local-user','0'.repeat(64));return 'ALLOWED'}catch(error){return error.name}}""",
                automation["automation_id"],
            )
            assert stale == "SecurityError"
            page.get_by_role("button", name="Approve exact configuration").click()
            page.wait_for_timeout(120)
            automation = page.evaluate("id=>window.AxiomAgents.store.getAutomation(id)", automation["automation_id"])
            assert automation["status"] == "ENABLED"

            mismatch = page.evaluate(
                """async id=>{try{await window.AxiomAgents.store.evaluateAutomation(id,{kind:'event',eventName:'artifact.updated'});return 'ALLOWED'}catch(error){return error.name}}""",
                automation["automation_id"],
            )
            assert mismatch == "NotAllowedError"
            page.get_by_role("button", name="Run local preview").click()
            page.wait_for_timeout(180)
            receipts = page.evaluate("()=>window.AxiomAgents.store.listReceipts()")
            run_receipt = next(receipt for receipt in receipts if receipt["schema"] == "musitu.axiom.automation-run-receipt.browser.v1")
            assert run_receipt["status"] == "PREVIEWED"
            assert run_receipt["external_action_executed"] is False
            assert run_receipt["network_request_performed"] is False
            assert run_receipt["plaintext_secret_access"] is False
            replay = page.evaluate("id=>window.AxiomObservability.store.replay(id)", run_receipt["run_id"])
            assert replay["integrity"]["status"] == "PASS"
            assert any(event["linkage"]["agent_id"] == child["agent_id"] for event in replay["events"])
            assert "chain_of_thought" not in json.dumps(replay, sort_keys=True)

            trigger_matrix = page.evaluate(
                """async root=>{const store=window.AxiomAgents.store,definitions=[
                  {name:'Scheduled project read',objective:'Preview project metadata every thirty elapsed minutes',trigger:{kind:'schedule',everyMinutes:30},signal:{kind:'schedule',elapsedMinutes:30}},
                  {name:'Open-task threshold',objective:'Preview project metadata after the approved task threshold',trigger:{kind:'condition',field:'project.open_tasks',operator:'gte',value:2},signal:{kind:'condition',field:'project.open_tasks',value:3}}
                ],results=[];for(const definition of definitions){const automation=await store.createAutomation(root,{name:definition.name,objective:definition.objective,trigger:definition.trigger,actionScope:'project.read'});await store.approveAutomation(automation.automation_id,'local-user',automation.config_sha256);const receipt=await store.evaluateAutomation(automation.automation_id,definition.signal);results.push({trigger:automation.trigger.kind,status:receipt.status,external:receipt.external_action_executed});}return results;}""",
                root["agent_id"],
            )
            assert trigger_matrix == [
                {"trigger": "schedule", "status": "PREVIEWED", "external": False},
                {"trigger": "condition", "status": "PREVIEWED", "external": False},
            ]
            event_count = page.evaluate("()=>window.AxiomAgents.store._all('events').then(rows=>rows.length)")
            assert event_count > 10

            tamper = page.evaluate(
                """async rid=>{const store=window.AxiomAgents.store,row=(await store.listReceipts()).find(item=>item.receipt_id===rid),original=structuredClone(row);row.config_sha256='0'.repeat(64);await store._put('receipts',row);const bad=await store.verify();await store._put('receipts',original);const good=await store.verify();return {bad,good};}""",
                run_receipt["receipt_id"],
            )
            assert tamper["bad"]["status"] == "FAIL"
            assert any(error.startswith("receipt_hash:run:") for error in tamper["bad"]["errors"])
            assert tamper["good"]["status"] == "PASS"

            page.reload(wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomAgentsBootstrap)")
            page.evaluate("()=>window.AxiomAgentsBootstrap")
            page.wait_for_timeout(120)
            persisted = page.evaluate("id=>window.AxiomAgents.store.listAgents(id)", project_id)
            assert len(persisted) == 2
            integrity = page.evaluate("()=>window.AxiomAgents.store.verify()")
            assert integrity["status"] == "PASS", integrity
            page.evaluate("id=>window.AxiomAgents.selectProject(id)", project_id)
            page.wait_for_timeout(80)

            page.keyboard.press("Control+K")
            assert page.locator("#composer-input").evaluate("element=>element===document.activeElement")

            root_card = page.locator("#agent-list .agent-record").filter(has_text="Research coordinator")
            root_card.get_by_role("button", name="Preview kill switch").click()
            page.wait_for_timeout(80)
            root_card = page.locator("#agent-list .agent-record").filter(has_text="Research coordinator")
            root_card.get_by_role("button", name="Confirm exact kill switch").click()
            page.wait_for_timeout(150)
            killed = page.evaluate("id=>window.AxiomAgents.store.listAgents(id)", project_id)
            assert {agent["status"] for agent in killed} == {"KILLED"}
            disabled = page.evaluate("id=>window.AxiomAgents.store.listAutomations(id)", project_id)
            assert len(disabled) == 3
            assert {row["status"] for row in disabled} == {"DISABLED"}
            blocked_after_kill = page.evaluate(
                """async id=>{try{await window.AxiomAgents.store.evaluateAutomation(id,{kind:'event',eventName:'project.updated'});return 'ALLOWED'}catch(error){return error.name}}""",
                automation["automation_id"],
            )
            assert blocked_after_kill == "InvalidStateError"
            final_integrity = page.evaluate("()=>window.AxiomAgents.store.verify()")
            assert final_integrity["status"] == "PASS", final_integrity
            page.screenshot(path=str(ARTIFACT_DIR / "phase9-agents-automations.png"), full_page=True)

            foreign_requests = [url for url in requests if not url.startswith(origin + "/")]
            assert foreign_requests == [], foreign_requests
            evidence = {
                "schema": "musitu.axiom.interface.phase9-agent-automation-browser-evidence.v1",
                "status": "PASS",
                "project_id": project_id,
                "root_agent_id": root["agent_id"],
                "delegated_agent_id": child["agent_id"],
                "automation_id": automation["automation_id"],
                "persistent_registry_verified": True,
                "workload_identity_verified": True,
                "least_privilege_delegation_verified": True,
                "tool_escalation_rejected": True,
                "foreign_owner_rejected": True,
                "exact_configuration_approval_verified": True,
                "stale_approval_rejected": True,
                "event_trigger_exact_match_verified": True,
                "schedule_trigger_verified": True,
                "condition_trigger_verified": True,
                "event_chain_over_ten_verified": True,
                "mismatched_trigger_rejected": True,
                "local_preview_receipt_verified": True,
                "observability_agent_linkage_verified": True,
                "tamper_detection_verified": True,
                "cross_reload_persistence_verified": True,
                "ctrl_k_inherited_focus_verified": True,
                "cascading_kill_switch_verified": True,
                "post_kill_execution_rejected": True,
                "network_policy": "DENY_ALL_EXTERNAL_NETWORK",
                "foreign_requests": foreign_requests,
                "cloud_scheduler_claimed": False,
                "external_action_execution_claimed": False,
                "production_workload_isolation_certified": False,
                "plaintext_secret_access_claimed": False,
                "integrity_sha256": final_integrity["integrity_sha256"],
            }
            (ARTIFACT_DIR / "phase9-agent-automation-browser-evidence.json").write_text(
                json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_INTERFACE_PHASE9_AGENT_AUTOMATION_BROWSER_PASS")


if __name__ == "__main__":
    main()
