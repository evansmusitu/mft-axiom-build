#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys


def main() -> None:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = "."
    # This exact inherited runner includes preflights, the Phase-7 semantic
    # gate, and every browser gate from Phase 1 through Phase 8.
    subprocess.check_call(
        [sys.executable, "frontier_v5/scripts/run_phase8_browser_regression_gate.py"],
        env=environment,
    )
    phase9_dir = "/tmp/axiom-interface-phase9"
    environment["AXIOM_PHASE9_ARTIFACT_DIR"] = phase9_dir
    subprocess.check_call(
        [sys.executable, "axiom_interface/tests/run_browser_phase9.py"],
        env=environment,
    )
    with open(f"{phase9_dir}/phase9-agent-automation-browser-evidence.json", encoding="utf-8") as handle:
        evidence = json.load(handle)
    required = [
        "persistent_registry_verified",
        "workload_identity_verified",
        "least_privilege_delegation_verified",
        "tool_escalation_rejected",
        "foreign_owner_rejected",
        "exact_configuration_approval_verified",
        "stale_approval_rejected",
        "event_trigger_exact_match_verified",
        "schedule_trigger_verified",
        "condition_trigger_verified",
        "event_chain_over_ten_verified",
        "mismatched_trigger_rejected",
        "local_preview_receipt_verified",
        "observability_agent_linkage_verified",
        "tamper_detection_verified",
        "cross_reload_persistence_verified",
        "ctrl_k_inherited_focus_verified",
        "cascading_kill_switch_verified",
        "post_kill_execution_rejected",
    ]
    assert evidence["status"] == "PASS"
    assert all(evidence[field] is True for field in required)
    assert evidence["network_policy"] == "DENY_ALL_EXTERNAL_NETWORK"
    assert evidence["foreign_requests"] == []
    assert evidence["cloud_scheduler_claimed"] is False
    assert evidence["external_action_execution_claimed"] is False
    assert evidence["production_workload_isolation_certified"] is False
    assert evidence["plaintext_secret_access_claimed"] is False
    print("MUSITU_AXIOM_INTERFACE_PHASE9_BROWSER_REGRESSION_PASS")


if __name__ == "__main__":
    main()
