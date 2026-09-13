#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys


def main() -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, "frontier_v5/scripts/run_phase12_browser_regression_gate.py"], env=env)
    root = "/tmp/axiom-interface-phase13"
    env["AXIOM_PHASE13_ARTIFACT_DIR"] = root
    subprocess.check_call([sys.executable, "axiom_interface/tests/run_browser_phase13.py"], env=env)
    with open(root + "/phase13-evidence-browser-evidence.json", encoding="utf-8") as handle:
        evidence = json.load(handle)
    required = [
        "public_read_ledger_preview_verified", "append_only_identity_reuse_rejected", "failed_evidence_visible",
        "not_run_external_baselines_visible", "external_versions_not_fabricated", "self_attestation_rejected",
        "claim_authorization_display_verified", "global_superiority_claim_blocked", "trust_documents_digest_bound",
        "downloadable_review_package_verified", "ctrl_k_inherited_focus_verified", "integrity_verified",
    ]
    assert evidence["status"] == "IMPLEMENTATION_PASS_AWAITING_INDEPENDENT_REVIEW"
    assert all(evidence[key] is True for key in required)
    assert evidence["foreign_requests"] == []
    for key in ["independent_review_complete", "phase13_earned", "public_deployment_claimed", "production_security_certified", "wcag_conformance_certified"]:
        assert evidence[key] is False
    print("MUSITU_AXIOM_INTERFACE_PHASE13_BROWSER_CANDIDATE_REGRESSION_PASS")


if __name__ == "__main__":
    main()

