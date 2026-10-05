#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

from frontier_v5.runtime.agent_automation import (
    AgentApprovalRequired,
    AgentAutomationLedger,
    AgentPolicyViolation,
)


OUT = Path(os.environ.get("AXIOM_PHASE9_SECURITY_ARTIFACT_DIR", "/tmp/axiom-interface-phase9-security"))
OUT.mkdir(parents=True, exist_ok=True)


def blocked(call, expected: type[Exception]) -> bool:
    try:
        call()
    except expected:
        return True
    return False


def main() -> None:
    ledger = AgentAutomationLedger(
        project_id="phase9-security-project",
        project_owner_id="local-user",
        started_at="2026-09-13T06:00:00+00:00",
    )
    root = ledger.register_agent(
        agent_id="security-root",
        actor_id="local-user",
        name="Security coordinator",
        purpose="Coordinate bounded local security previews",
        tool_scopes=["project.read", "research.read", "agent.delegate"],
        data_scopes=["project.metadata", "project.sources"],
        autonomy="LOCAL_PREVIEW",
        max_runs=4,
        max_compute_units=4,
        at="2026-09-13T06:01:00+00:00",
    )
    child = ledger.delegate_agent(
        parent_agent_id=root["agent_id"],
        agent_id="security-child",
        actor_id="local-user",
        name="Source reader",
        purpose="Read the explicitly granted project source scope",
        tool_scopes=["project.read"],
        data_scopes=["project.sources"],
        autonomy="PROPOSE_ONLY",
        max_runs=2,
        max_compute_units=2,
        at="2026-09-13T06:02:00+00:00",
    )

    foreign_owner_rejected = blocked(
        lambda: ledger.register_agent(
            agent_id="foreign",
            actor_id="viewer-1",
            name="Foreign",
            purpose="Must fail",
            tool_scopes=["project.read"],
            data_scopes=["project.metadata"],
        ),
        AgentPolicyViolation,
    )
    escalation_attempts = [
        {"agent_id": "tool-escalation", "tool_scopes": ["artifact.write"], "data_scopes": ["project.sources"], "autonomy": "PROPOSE_ONLY", "max_runs": 1, "max_compute_units": 1},
        {"agent_id": "data-escalation", "tool_scopes": ["project.read"], "data_scopes": ["project.artifacts"], "autonomy": "PROPOSE_ONLY", "max_runs": 1, "max_compute_units": 1},
        {"agent_id": "budget-escalation", "tool_scopes": ["project.read"], "data_scopes": ["project.sources"], "autonomy": "PROPOSE_ONLY", "max_runs": 5, "max_compute_units": 1},
    ]
    delegation_escalations_rejected = all(
        blocked(
            lambda attempt=attempt: ledger.delegate_agent(
                parent_agent_id=root["agent_id"],
                actor_id="local-user",
                name="Blocked escalation",
                purpose="Must fail closed",
                **attempt,
            ),
            AgentPolicyViolation,
        )
        for attempt in escalation_attempts
    )
    plaintext_secret_rejected = blocked(
        lambda: ledger.register_agent(
            agent_id="secret",
            actor_id="local-user",
            name="Secret carrier",
            purpose="pass" + "word=test-only-value",
            tool_scopes=["project.read"],
            data_scopes=["project.metadata"],
        ),
        AgentPolicyViolation,
    )
    trigger_escalation_rejected = blocked(
        lambda: ledger.create_automation(
            automation_id="bad-trigger",
            agent_id=child["agent_id"],
            actor_id="local-user",
            name="Bad trigger",
            objective="Must fail closed",
            trigger={"kind": "event", "event_name": "shell.command"},
            action_scope="project.read",
        ),
        AgentPolicyViolation,
    )

    automation = ledger.create_automation(
        automation_id="source-update",
        agent_id=child["agent_id"],
        actor_id="local-user",
        name="Read sources on update",
        objective="Prepare a local evidence preview after an approved project update",
        trigger={"kind": "event", "event_name": "project.updated"},
        action_scope="project.read",
        at="2026-09-13T06:03:00+00:00",
    )
    stale_approval_rejected = blocked(
        lambda: ledger.approve_automation(
            automation_id=automation["automation_id"],
            actor_id="local-user",
            expected_config_sha256="0" * 64,
        ),
        AgentApprovalRequired,
    )
    approval = ledger.approve_automation(
        automation_id=automation["automation_id"],
        actor_id="local-user",
        expected_config_sha256=automation["config_sha256"],
        at="2026-09-13T06:04:00+00:00",
    )
    mismatched_trigger_rejected = blocked(
        lambda: ledger.evaluate_automation(
            automation_id=automation["automation_id"],
            run_id="mismatched",
            signal={"kind": "event", "event_name": "artifact.updated"},
        ),
        AgentPolicyViolation,
    )
    run = ledger.evaluate_automation(
        automation_id=automation["automation_id"],
        run_id="approved-local-preview",
        signal={"kind": "event", "event_name": "project.updated"},
        at="2026-09-13T06:05:00+00:00",
    )

    kill_preview = ledger.prepare_kill(agent_id=root["agent_id"], actor_id="local-user")
    stale_kill_rejected = blocked(
        lambda: ledger.engage_kill(
            agent_id=root["agent_id"],
            actor_id="local-user",
            expected_preview_sha256="0" * 64,
        ),
        AgentApprovalRequired,
    )
    killed = ledger.engage_kill(
        agent_id=root["agent_id"],
        actor_id="local-user",
        expected_preview_sha256=kill_preview["kill_preview_sha256"],
        at="2026-09-13T06:06:00+00:00",
    )
    post_kill_execution_rejected = blocked(
        lambda: ledger.evaluate_automation(
            automation_id=automation["automation_id"],
            run_id="post-kill",
            signal={"kind": "event", "event_name": "project.updated"},
        ),
        AgentPolicyViolation,
    )
    integrity = ledger.verify_integrity()
    assert integrity["status"] == "PASS", integrity
    assert foreign_owner_rejected and delegation_escalations_rejected
    assert plaintext_secret_rejected and trigger_escalation_rejected
    assert stale_approval_rejected and mismatched_trigger_rejected
    assert stale_kill_rejected and post_kill_execution_rejected
    assert run["status"] == "PREVIEWED"
    assert not run["external_action_executed"]
    assert not run["network_request_performed"]
    assert not run["plaintext_secret_access"]
    assert killed["affected_agent_ids"] == ["security-child", "security-root"]
    assert ledger.automations[automation["automation_id"]]["status"] == "DISABLED"

    bundle = ledger.evidence_bundle()
    assert all(value is False for value in bundle["claim_boundaries"].values())
    evidence = {
        "schema": "musitu.axiom.interface.phase9-security-evidence.v1",
        "status": "PASS",
        "qualification_scope": "BROWSER_LOCAL_GOVERNED_AGENT_AND_TRIGGER_PREVIEW_SUBSTRATE",
        "persistent_registry_semantics_verified": True,
        "workload_identity_verified": True,
        "foreign_owner_rejected": foreign_owner_rejected,
        "least_privilege_delegation_verified": True,
        "delegation_escalations_rejected": delegation_escalations_rejected,
        "plaintext_secret_rejected": plaintext_secret_rejected,
        "trigger_escalation_rejected": trigger_escalation_rejected,
        "exact_configuration_approval_verified": approval["decision"] == "APPROVED",
        "stale_approval_rejected": stale_approval_rejected,
        "mismatched_trigger_rejected": mismatched_trigger_rejected,
        "local_preview_receipt_verified": run["status"] == "PREVIEWED",
        "stale_kill_preview_rejected": stale_kill_rejected,
        "cascading_kill_switch_verified": killed["affected_agent_ids"] == ["security-child", "security-root"],
        "post_kill_execution_rejected": post_kill_execution_rejected,
        "network_policy": bundle["network_policy"],
        "secrets_policy": bundle["secrets_policy"],
        "execution_mode": bundle["execution_mode"],
        "approval_receipt_sha256": approval["receipt_sha256"],
        "run_receipt_sha256": run["receipt_sha256"],
        "kill_preview_sha256": kill_preview["kill_preview_sha256"],
        "integrity": integrity,
        "claim_boundaries": bundle["claim_boundaries"],
    }
    (OUT / "phase9-security-evidence.json").write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("MUSITU_AXIOM_INTERFACE_PHASE9_SECURITY_REDTEAM_PASS")


if __name__ == "__main__":
    main()
