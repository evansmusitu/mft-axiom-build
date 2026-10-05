#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys

from frontier_v5.runtime.pwa_resilience import DeviceNetworkMatrixGate


def main() -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, "frontier_v5/scripts/run_phase13_browser_regression_gate.py"], env=env)
    root = "/tmp/axiom-interface-phase14"
    env["AXIOM_PHASE14_ARTIFACT_DIR"] = root
    subprocess.check_call([sys.executable, "axiom_interface/tests/run_browser_phase14.py"], env=env)
    with open(root + "/phase14-pwa-browser-evidence.json", encoding="utf-8") as handle:
        evidence = json.load(handle)
    matrix = DeviceNetworkMatrixGate().evaluate(evidence["matrix"])
    required = [
        "installable_manifest_verified", "service_worker_cached_shell_verified", "offline_project_access_verified",
        "offline_reload_verified", "exact_local_queue_verified", "reconnect_replay_verified",
        "external_side_effect_absent", "constrained_network_adaptation_verified", "mobile_ergonomics_verified",
        "tablet_ergonomics_verified", "ctrl_k_inherited_focus_verified",
    ]
    assert evidence["status"] == "IMPLEMENTATION_PASS_REAL_DEVICE_REQUIRED"
    assert all(evidence[key] is True for key in required)
    assert evidence["foreign_requests"] == []
    assert matrix["implementation_ready"] is True and matrix["phase14_qualification_allowed"] is False
    for key in ["authenticated_real_device_present", "real_device_certification_claimed", "native_binary_claimed", "app_store_release_claimed", "cloud_offline_sync_claimed", "phase14_earned"]:
        assert evidence[key] is False
    print("MUSITU_AXIOM_INTERFACE_PHASE14_BROWSER_CANDIDATE_REGRESSION_PASS_REAL_DEVICE_REQUIRED")


if __name__ == "__main__":
    main()

