#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys


def run(*args: str, environment: dict[str, str] | None = None) -> None:
    selected = os.environ.copy() if environment is None else environment.copy()
    selected["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, *args], env=selected)


def main() -> None:
    run("frontier_v5/scripts/verify_phase12_authority.py")
    run("frontier_v5/scripts/run_phase14_browser_regression_gate.py")
    output = os.environ.get("AXIOM_BROWSER_APPLICATION_ARTIFACT_DIR", "/tmp/axiom-browser-application")
    environment = os.environ.copy()
    environment["AXIOM_BROWSER_APPLICATION_ARTIFACT_DIR"] = output
    run("axiom_interface/tests/run_browser_application.py", environment=environment)
    with open(os.path.join(output, "browser-application-evidence.json"), encoding="utf-8") as handle:
        evidence = json.load(handle)
    required = [
        "root_inline_html_verified",
        "download_absent",
        "guest_launch_verified",
        "authenticated_cookie_session_verified",
        "authenticated_refresh_restore_verified",
        "authenticated_sign_out_verified",
        "hash_deep_link_verified",
        "deep_link_refresh_verified",
        "legacy_index_normalized_without_reload",
        "desktop_viewport_verified",
        "mobile_viewport_verified",
        "pwa_entry_verified",
        "native_paths_separate",
        "redirect_loop_absent",
    ]
    assert evidence["status"] in {"DEPLOYMENT_CANDIDATE_PASS", "PRODUCTION_SOURCE_CONTRACT_PASS"}
    assert all(evidence[name] is True for name in required)
    assert evidence["foreign_requests"] == []
    assert evidence["production_identity_integration_claimed"] is evidence["production_deployment_claimed"]
    print("MUSITU_AXIOM_BROWSER_APPLICATION_BROWSER_REGRESSION_PASS")


if __name__ == "__main__":
    main()
