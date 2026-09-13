from __future__ import annotations

from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
SECURITY = (ROOT / "agent_security.js").read_text(encoding="utf-8")
STORE = (ROOT / "agent_store.js").read_text(encoding="utf-8")
UI = (ROOT / "agent_ui.js").read_text(encoding="utf-8")
MARKUP = (ROOT / "agent_ui_markup.js").read_text(encoding="utf-8")
BOOT = (ROOT / "agents_bootstrap.js").read_text(encoding="utf-8")
CSS = (ROOT / "styles" / "agents.css").read_text(encoding="utf-8")
LIVE = (ROOT / "live_durability.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))


class Phase9AgentAutomationContractTests(unittest.TestCase):
    def test_phase9_remains_unearned_until_exact_green_authority_is_sealed(self):
        authority = SURFACE["authority"]
        phase9_sha = authority.get("qualified_phase9_sha")
        if phase9_sha is None:
            self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v8")
            self.assertEqual(SURFACE["phase"], "PHASE_8_COMPUTER_BROWSER_EXECUTION")
            self.assertNotIn("agent_automation_substrate", SURFACE)
            return
        self.assertRegex(phase9_sha, r"^[0-9a-f]{40}$")
        self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v9")
        self.assertEqual(SURFACE["phase"], "PHASE_9_AGENTS_AUTOMATIONS")
        substrate = SURFACE["agent_automation_substrate"]
        self.assertEqual(substrate["status"], "EARNED")
        self.assertEqual(substrate["qualified_sha"], phase9_sha)
        self.assertEqual(substrate["qualification_scope"], "BROWSER_LOCAL_GOVERNED_AGENT_AND_TRIGGER_PREVIEW_SUBSTRATE")
        self.assertFalse(substrate["cloud_scheduler_claimed"])
        self.assertFalse(substrate["external_action_execution_claimed"])
        self.assertFalse(substrate["production_workload_isolation_certified"])
        self.assertFalse(substrate["plaintext_secret_access_claimed"])

    def test_persistent_registry_contains_agents_automations_events_and_receipts(self):
        self.assertIn("musitu-axiom-agents-v1", STORE)
        for name in ["agents", "automations", "events", "receipts"]:
            self.assertIn(f"'{name}'", STORE)
        self.assertIn("workload_identity_id", STORE)
        for field in ["organization_id", "model_policy", "deployment_environment", "evaluation_history", "incident_history"]:
            self.assertIn(field, STORE)
        self.assertIn("grant_sha256", STORE)
        self.assertIn("config_sha256", STORE)
        self.assertIn("receipt_sha256", STORE)
        self.assertIn("previous_event_sha256", STORE)
        self.assertIn("sort((a,b)=>a.sequence-b.sequence)", STORE)

    def test_least_privilege_delegation_budget_and_kill_switch_fail_closed(self):
        self.assertIn("grantIsSubset", SECURITY)
        self.assertIn("requireDelegation", SECURITY)
        self.assertIn("MAX_DELEGATION_DEPTH", SECURITY)
        self.assertIn("agent.delegate", SECURITY)
        self.assertIn("delegated grant must be an exact least-privilege subset", SECURITY)
        self.assertIn("QuotaExceededError", STORE)
        self.assertIn("prepareKill", STORE)
        self.assertIn("stale or altered kill preview", STORE)
        self.assertIn("ANCESTOR_KILL_SWITCH", STORE)

    def test_schedule_event_condition_and_exact_approval_are_bounded(self):
        for literal in ["schedule", "event", "condition", "project.updated", "project.open_tasks"]:
            self.assertIn(literal, SECURITY)
        self.assertIn("stale or altered automation configuration", STORE)
        self.assertIn("HUMAN_EACH_CONFIGURATION", SECURITY)
        self.assertIn("trigger does not match the approved automation", STORE)
        self.assertIn("LOCAL_PREVIEW_ONLY_NO_EXTERNAL_ACTION", SECURITY)

    def test_network_secrets_external_execution_and_cloud_scheduler_claims_remain_false(self):
        self.assertIn("DENY_ALL_EXTERNAL_NETWORK", SECURITY)
        self.assertIn("SYMBOLIC_REFERENCE_ONLY_NO_PLAINTEXT_SECRETS", SECURITY)
        self.assertIn("external_action_executed:false", STORE)
        self.assertIn("network_request_performed:false", STORE)
        self.assertIn("plaintext_secret_access:false", STORE)
        self.assertIn("cloud_scheduler_claimed:false", STORE)
        self.assertNotIn("fetch(", STORE)
        self.assertNotIn("WebSocket(", STORE)
        self.assertNotIn("EventSource(", STORE)

    def test_accessible_visible_controls_and_progressive_bootstrap_exist(self):
        for label in ["Register agent", "Create delegated agent", "Create approval-bound draft", "Preview kill switch", "Run local preview"]:
            self.assertIn(label, MARKUP + UI)
        self.assertIn('aria-live="polite"', MARKUP)
        self.assertIn("max-width:52rem", CSS)
        self.assertIn('data-workspace-owner="agents"', CSS)
        self.assertIn("prefers-reduced-motion:reduce", CSS)
        self.assertIn("forced-colors:active", CSS)
        self.assertIn("AxiomProjects", BOOT)
        self.assertIn("AxiomObservability", BOOT)
        self.assertIn("AxiomArtifacts", BOOT)
        self.assertIn("AxiomComputer", BOOT)
        self.assertIn('data-route="automations"', BOOT)
        self.assertIn("project\\/agents", UI)
        self.assertIn("import('./agents_bootstrap.js')", LIVE)
        for asset in ["./agents_bootstrap.js", "./agent_security.js", "./agent_store.js", "./agent_ui.js", "./agent_ui_markup.js", "./styles/agents.css"]:
            self.assertIn(asset, SW)

    def test_observability_links_agent_policy_and_verification_without_private_reasoning(self):
        self.assertIn("agent_id", STORE)
        self.assertIn("policy_decision_id", STORE)
        self.assertIn("verification_id", STORE)
        self.assertIn("LEAST_PRIVILEGE_PASS", STORE)
        self.assertNotIn("chain_of_thought", STORE)
        self.assertNotIn("private_reasoning", STORE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
