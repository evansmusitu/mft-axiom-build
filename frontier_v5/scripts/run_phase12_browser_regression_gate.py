#!/usr/bin/env python3
from __future__ import annotations
import json
import os
import subprocess
import sys


def main() -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, "frontier_v5/scripts/run_phase11_browser_regression_gate.py"], env=env)
    root = "/tmp/axiom-interface-phase12"
    env["AXIOM_PHASE12_ARTIFACT_DIR"] = root
    subprocess.check_call([sys.executable, "axiom_interface/tests/run_browser_phase12.py"], env=env)
    evidence = json.load(open(root + "/phase12-developer-browser-evidence.json", encoding="utf-8"))
    required = [
        "symbolic_credential_only_verified", "secret_like_material_rejected", "exact_install_digest_verified",
        "stale_install_digest_rejected", "least_privilege_verified", "mcp_2026_local_descriptor_verified",
        "a2a_local_card_verified", "webhook_signed_fixture_no_delivery_verified", "untrusted_code_nonexecution_verified",
        "cross_reload_persistence_verified", "route_ownership_verified", "ctrl_k_inherited_focus_verified", "integrity_verified",
    ]
    assert evidence["status"] == "PASS" and all(evidence[key] is True for key in required)
    assert evidence["foreign_requests"] == [] and evidence["network_policy"] == "DENY_ALL_EXTERNAL_NETWORK"
    assert evidence["platform_mode"] == "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY"
    for key in ["production_api_key_issued", "remote_mcp_binding_claimed", "outbound_webhook_delivery_claimed", "untrusted_package_code_executed", "external_conformance_certification_claimed"]:
        assert evidence[key] is False
    print("MUSITU_AXIOM_INTERFACE_PHASE12_BROWSER_REGRESSION_PASS")


if __name__ == "__main__":
    main()
