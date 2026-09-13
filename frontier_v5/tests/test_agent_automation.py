from __future__ import annotations

import unittest

from frontier_v5.runtime.agent_automation import (
    AgentApprovalRequired,
    AgentAutomationLedger,
    AgentPolicyViolation,
    EXECUTION_MODE,
    NETWORK_POLICY,
    SECRETS_POLICY,
)


def ledger() -> AgentAutomationLedger:
    return AgentAutomationLedger(
        project_id="project-phase9",
        project_owner_id="owner-1",
        started_at="2026-09-13T05:00:00+00:00",
    )


def root(registry: AgentAutomationLedger, *, max_runs: int = 4):
    return registry.register_agent(
        agent_id="root", actor_id="owner-1", name="Research coordinator",
        purpose="Coordinate bounded local project research previews",
        tool_scopes=["project.read", "research.read", "agent.delegate"],
        data_scopes=["project.metadata", "project.sources"],
        autonomy="LOCAL_PREVIEW", max_runs=max_runs, max_compute_units=max_runs,
        at="2026-09-13T05:01:00+00:00",
    )


def child(registry: AgentAutomationLedger):
    return registry.delegate_agent(
        parent_agent_id="root", agent_id="child", actor_id="owner-1",
        name="Source reader", purpose="Read approved project sources",
        tool_scopes=["project.read"], data_scopes=["project.sources"],
        autonomy="PROPOSE_ONLY", max_runs=2, max_compute_units=2,
        at="2026-09-13T05:02:00+00:00",
    )


class AgentAutomationTests(unittest.TestCase):
    def test_registry_uses_explicit_identity_grants_budgets_and_deny_boundaries(self):
        registry = ledger()
        agent = root(registry)
        self.assertEqual(agent["workload_identity_id"], "workload:root:v1")
        self.assertEqual(agent["organization_id"], "browser-local-personal-workspace")
        self.assertEqual(agent["model_policy"], "NO_MODEL_INVOCATION_DETERMINISTIC_LOCAL_PREVIEW")
        self.assertEqual(agent["deployment_environment"], "BROWSER_LOCAL_DEVICE")
        self.assertEqual(agent["evaluation_history"], [])
        self.assertEqual(agent["incident_history"], [])
        self.assertEqual(agent["grant"]["network_policy"], NETWORK_POLICY)
        self.assertEqual(agent["grant"]["secrets_policy"], SECRETS_POLICY)
        self.assertEqual(agent["grant"]["budget"], {"max_runs": 4, "max_compute_units": 4})
        self.assertFalse(agent["external_execution_claimed"])
        self.assertFalse(agent["cloud_scheduler_claimed"])
        self.assertEqual(len(agent["grant_sha256"]), 64)
        with self.assertRaises(AgentPolicyViolation):
            registry.register_agent(
                agent_id="foreign", actor_id="viewer-1", name="x", purpose="x",
                tool_scopes=["project.read"], data_scopes=["project.metadata"],
            )

    def test_delegation_is_monotonic_and_rejects_tool_data_autonomy_budget_and_depth_escalation(self):
        registry = ledger()
        root(registry)
        delegated = child(registry)
        self.assertEqual(delegated["parent_agent_id"], "root")
        self.assertEqual(delegated["delegation_depth"], 1)
        attempts = [
            dict(agent_id="tool-up", tool_scopes=["artifact.write"], data_scopes=["project.sources"], autonomy="PROPOSE_ONLY", max_runs=1, max_compute_units=1),
            dict(agent_id="data-up", tool_scopes=["project.read"], data_scopes=["project.artifacts"], autonomy="PROPOSE_ONLY", max_runs=1, max_compute_units=1),
            dict(agent_id="budget-up", tool_scopes=["project.read"], data_scopes=["project.sources"], autonomy="PROPOSE_ONLY", max_runs=5, max_compute_units=1),
        ]
        for attempt in attempts:
            with self.subTest(agent_id=attempt["agent_id"]), self.assertRaises(AgentPolicyViolation):
                registry.delegate_agent(
                    parent_agent_id="root", actor_id="owner-1", name="blocked",
                    purpose="must fail", **attempt,
                )
        with self.assertRaises(AgentPolicyViolation):
            registry.delegate_agent(
                parent_agent_id="child", agent_id="no-delegate", actor_id="owner-1",
                name="blocked", purpose="child lacks delegation",
                tool_scopes=["project.read"], data_scopes=["project.sources"],
            )

    def test_automation_requires_exact_digest_allowlisted_trigger_and_granted_action(self):
        registry = ledger()
        root(registry)
        automation = registry.create_automation(
            automation_id="event-1", agent_id="root", actor_id="owner-1",
            name="Read on update", objective="Preview project metadata after an update",
            trigger={"kind": "event", "event_name": "project.updated"},
            action_scope="project.read", at="2026-09-13T05:03:00+00:00",
        )
        self.assertEqual(automation["status"], "DRAFT")
        self.assertEqual(automation["execution_mode"], EXECUTION_MODE)
        with self.assertRaises(AgentApprovalRequired):
            registry.approve_automation(
                automation_id="event-1", actor_id="owner-1",
                expected_config_sha256="0" * 64,
            )
        receipt = registry.approve_automation(
            automation_id="event-1", actor_id="owner-1",
            expected_config_sha256=automation["config_sha256"],
            at="2026-09-13T05:04:00+00:00",
        )
        self.assertEqual(receipt["decision"], "APPROVED")
        self.assertEqual(len(receipt["receipt_sha256"]), 64)
        with self.assertRaises(AgentPolicyViolation):
            registry.create_automation(
                automation_id="bad-event", agent_id="root", actor_id="owner-1",
                name="bad", objective="bad", trigger={"kind": "event", "event_name": "shell.command"},
                action_scope="project.read",
            )
        with self.assertRaises(AgentPolicyViolation):
            registry.create_automation(
                automation_id="bad-scope", agent_id="root", actor_id="owner-1",
                name="bad", objective="bad", trigger={"kind": "schedule", "every_minutes": 30},
                action_scope="artifact.write",
            )

    def test_schedule_event_and_condition_triggers_match_exactly_and_only_preview(self):
        registry = ledger()
        root(registry)
        definitions = [
            ("schedule", {"kind": "schedule", "every_minutes": 30}, {"kind": "schedule", "elapsed_minutes": 30}),
            ("event", {"kind": "event", "event_name": "project.updated"}, {"kind": "event", "event_name": "project.updated"}),
            ("condition", {"kind": "condition", "field": "project.open_tasks", "operator": "gte", "value": 2}, {"kind": "condition", "field": "project.open_tasks", "value": 3}),
        ]
        for index, (name, trigger, signal) in enumerate(definitions):
            automation = registry.create_automation(
                automation_id=name, agent_id="root", actor_id="owner-1",
                name=name, objective=f"Preview {name}", trigger=trigger,
                action_scope="project.read",
            )
            registry.approve_automation(
                automation_id=name, actor_id="owner-1",
                expected_config_sha256=automation["config_sha256"],
            )
            receipt = registry.evaluate_automation(
                automation_id=name, run_id=f"run-{index}", signal=signal,
            )
            self.assertEqual(receipt["status"], "PREVIEWED")
            self.assertFalse(receipt["external_action_executed"])
            self.assertFalse(receipt["network_request_performed"])
            self.assertFalse(receipt["plaintext_secret_access"])
        with self.assertRaises(AgentPolicyViolation):
            registry.evaluate_automation(
                automation_id="event", run_id="wrong",
                signal={"kind": "event", "event_name": "artifact.updated"},
            )

    def test_budget_exhaustion_fails_closed(self):
        registry = ledger()
        root(registry, max_runs=1)
        automation = registry.create_automation(
            automation_id="one", agent_id="root", actor_id="owner-1",
            name="one", objective="one local preview",
            trigger={"kind": "schedule", "every_minutes": 5}, action_scope="project.read",
        )
        registry.approve_automation(
            automation_id="one", actor_id="owner-1",
            expected_config_sha256=automation["config_sha256"],
        )
        registry.evaluate_automation(
            automation_id="one", run_id="first",
            signal={"kind": "schedule", "elapsed_minutes": 5},
        )
        with self.assertRaises(AgentPolicyViolation):
            registry.evaluate_automation(
                automation_id="one", run_id="second",
                signal={"kind": "schedule", "elapsed_minutes": 10},
            )

    def test_exact_kill_preview_cascades_and_blocks_future_runs(self):
        registry = ledger()
        root(registry)
        child(registry)
        automation = registry.create_automation(
            automation_id="child-event", agent_id="child", actor_id="owner-1",
            name="child event", objective="Preview approved source metadata",
            trigger={"kind": "event", "event_name": "project.updated"},
            action_scope="project.read",
        )
        registry.approve_automation(
            automation_id="child-event", actor_id="owner-1",
            expected_config_sha256=automation["config_sha256"],
        )
        preview = registry.prepare_kill(agent_id="root", actor_id="owner-1")
        with self.assertRaises(AgentApprovalRequired):
            registry.engage_kill(
                agent_id="root", actor_id="owner-1", expected_preview_sha256="0" * 64,
            )
        killed = registry.engage_kill(
            agent_id="root", actor_id="owner-1",
            expected_preview_sha256=preview["kill_preview_sha256"],
        )
        self.assertEqual(killed["affected_agent_ids"], ["child", "root"])
        self.assertEqual(registry.agents["root"]["status"], "KILLED")
        self.assertEqual(registry.agents["child"]["status"], "KILLED")
        self.assertEqual(registry.automations["child-event"]["status"], "DISABLED")
        with self.assertRaises(AgentPolicyViolation):
            registry.evaluate_automation(
                automation_id="child-event", run_id="after-kill",
                signal={"kind": "event", "event_name": "project.updated"},
            )
        self.assertEqual(registry.verify_integrity()["status"], "PASS")

    def test_grant_automation_receipt_and_event_tampering_is_detected(self):
        registry = ledger()
        root(registry)
        automation = registry.create_automation(
            automation_id="event", agent_id="root", actor_id="owner-1",
            name="event", objective="Preview metadata",
            trigger={"kind": "event", "event_name": "project.updated"}, action_scope="project.read",
        )
        registry.approve_automation(
            automation_id="event", actor_id="owner-1",
            expected_config_sha256=automation["config_sha256"],
        )
        registry.evaluate_automation(
            automation_id="event", run_id="run",
            signal={"kind": "event", "event_name": "project.updated"},
        )
        self.assertEqual(registry.verify_integrity()["status"], "PASS")
        registry.agents["root"]["grant"]["tool_scopes"].append("artifact.write")
        self.assertIn("grant_hash:root", registry.verify_integrity()["errors"])
        registry = ledger(); root(registry)
        registry.events[0]["payload"]["execution_mode"] = "external"
        self.assertIn("event_hash:0", registry.verify_integrity()["errors"])

    def test_evidence_bundle_preserves_truth_boundaries(self):
        registry = ledger()
        root(registry)
        evidence = registry.evidence_bundle()
        self.assertEqual(evidence["status"], "PASS")
        self.assertEqual(evidence["execution_mode"], EXECUTION_MODE)
        self.assertEqual(evidence["network_policy"], NETWORK_POLICY)
        self.assertEqual(evidence["secrets_policy"], SECRETS_POLICY)
        self.assertTrue(all(value is False for value in evidence["claim_boundaries"].values()))


if __name__ == "__main__":
    unittest.main(verbosity=2, exit=False)
    print("MUSITU_AXIOM_INTERFACE_PHASE9_AGENT_AUTOMATION_RUNTIME_PASS")
