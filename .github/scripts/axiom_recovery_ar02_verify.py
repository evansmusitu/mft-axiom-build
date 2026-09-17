#!/usr/bin/env python3
"""Fail-closed verifier for the local AR-02 isolation foundation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PARENT = "87c105608ae658bd5b1f50bc718523ace54a5f5c"
BRANCH = "frontier/axiom-recovery-ar02-20260917"
ALLOWED_PREFIXES = (
    ".github/scripts/axiom_recovery_ar02_verify.py",
    ".github/workflows/axiom-recovery-ar02-isolation.yml",
    "docs/axiom_recovery/AR02_",
    "recovery/ar02/",
)

sys.path.insert(0, str(ROOT))

from recovery.ar02.isolation import (  # noqa: E402
    EXPECTED_ENVIRONMENTS,
    IsolationError,
    load_manifest,
    provision_local,
    validate_manifest,
    verify_local,
)


errors: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        errors.append(message)


def git(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *arguments],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def verify_repository_boundary() -> None:
    branch = git("branch", "--show-current")
    branch_name = branch.stdout.strip() or os.environ.get("GITHUB_REF_NAME", "")
    check(branch.returncode == 0 and branch_name == BRANCH, "unexpected AR-02 branch")
    ancestry = git("merge-base", "--is-ancestor", PARENT, "HEAD")
    check(ancestry.returncode == 0, "published AR-00/AR-01 commit is not an ancestor")

    committed = git("diff", "--name-only", f"{PARENT}..HEAD")
    check(committed.returncode == 0, "cannot inspect committed AR-02 scope")
    status = git("status", "--porcelain", "--untracked-files=all")
    check(status.returncode == 0, "cannot inspect AR-02 working tree")
    paths = committed.stdout.splitlines()
    for line in status.stdout.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.append(path)
    for path in paths:
        check(path.startswith(ALLOWED_PREFIXES), f"AR-02 scope escape: {path}")

    frozen_trees = {
        "axiom_interface": "c9aa15f2cde244e1669f75ca314fcfb4ae8e8da2",
        "axiom_interface/vnext": "7b9a3f6d485a03b17945e7fd12e120631c56a257",
        "frontier_v5": "b4478c2e462126568dbf34f1f5b40ecc29da24ed",
        "frontier_review_safe": "5c8bda7a41af7f9eb7b4b0a9e1c5cd9ab0207423",
        "mcp": "1ca86d943145df743d5eff5e58a8c46052478de0",
        "auth": "d2814277d6b3a9c12bb0332e4acfd44ccfc9dcd4",
        "ops": "ff8527fbc7864fe880745db3813499fb67adab5c",
        "docs/axiom_final_product": "dac3acb632c1772d0377b93e41e37c02af63539d",
    }
    for path, expected in frozen_trees.items():
        result = git("rev-parse", f"HEAD:{path}")
        check(result.returncode == 0 and result.stdout.strip() == expected, f"protected tree changed: {path}")
        dirty = git("status", "--porcelain", "--", path)
        check(dirty.returncode == 0 and not dirty.stdout.strip(), f"protected path dirty: {path}")

    legacy = ROOT / ".github" / "workflows" / "axiom-runtime-connection-staging-canary.yml"
    text = legacy.read_text(encoding="utf-8")
    check("D1_NAME: musitu-axiom-prod" in text, "legacy unsafe binding truth unexpectedly changed")
    check("D1_UUID: 504029cc-f9a5-495e-818f-63c6144b4ea4" in text, "legacy production D1 identity truth unexpectedly changed")


def verify_contract_and_behavior() -> None:
    manifest = validate_manifest(load_manifest())
    check(manifest["mode"] == "LOCAL_ZERO_COST", "AR-02 is not zero-cost local mode")
    check(manifest["estimated_external_cost_usd"] == 0, "external cost is not zero")
    check(manifest["network_required"] is False, "network was made required")
    check(manifest["provider_api_key_required"] is False, "provider API key was made required")
    check(manifest["production_authority"] is False, "production authority present")
    check({row["environment_id"] for row in manifest["environments"]} == EXPECTED_ENVIRONMENTS, "environment set mismatch")

    acceptance_path = ROOT / "docs" / "axiom_recovery" / "AR02_ACCEPTANCE_MATRIX.json"
    try:
        acceptance = json.loads(acceptance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load AR-02 acceptance matrix: {exc}")
        acceptance = {}
    check(acceptance.get("candidate_state") == "LOCAL_FOUNDATION_IMPLEMENTED_CLOUD_ISOLATION_PENDING", "AR-02 state overstated or missing")
    boundary = acceptance.get("claim_boundary", {})
    for key in ("ar02_complete", "runtime_connection_modified", "staging_deployed", "canary_deployed", "production_data_accessed", "production_mutated", "production_authority"):
        check(boundary.get(key) is False, f"AR-02 claim boundary must keep {key}=false")
    check(boundary.get("full_product_connection") == "NOT_PROVEN", "full product connection overstated")
    check(boundary.get("superiority") == "NOT_CERTIFIED", "superiority overstated")
    external = acceptance.get("external_exit_gates", {})
    check(external and all(value is False for value in external.values()), "an external exit gate was claimed without evidence")

    resource_plan_path = ROOT / "docs" / "axiom_recovery" / "AR02_ZERO_COST_RESOURCE_PLAN.json"
    try:
        resource_plan = json.loads(resource_plan_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load AR-02 zero-cost resource plan: {exc}")
        resource_plan = {}
    check(resource_plan.get("status") == "OFFICIAL_LIMITS_VERIFIED_ACCOUNT_HEADROOM_PENDING", "zero-cost account headroom was overstated")
    check(resource_plan.get("resources_created") is False, "resource plan claims external creation")
    check(resource_plan.get("billing_mutation_authorized") is False, "billing mutation was authorized")
    check(resource_plan.get("production_authority") is False, "resource plan claims production authority")

    try:
        with tempfile.TemporaryDirectory(prefix="axiom-ar02-verify-") as directory:
            provisioned = provision_local(directory)
            verified = verify_local(directory)
            check(provisioned["status"] == "PASS_LOCAL_NON_PRODUCTION_ISOLATION", "local provisioning did not pass")
            check(verified["status"] == "PASS_LOCAL_NON_PRODUCTION_ISOLATION", "local verification did not pass")
            check(provisioned["schema_sha256"] == verified["schema_sha256"], "schema digest changed after provisioning")
            check(verified["physical_database_separation_verified"] is True, "physical separation not verified")
            check(verified["network_used"] is False, "network use claimed")
            check(verified["provider_api_key_used"] is False, "provider key use claimed")
            check(verified["production_authority"] is False, "local evidence claims production authority")
    except IsolationError as exc:
        errors.append(f"local isolation exercise failed: {exc}")


def main() -> int:
    verify_repository_boundary()
    verify_contract_and_behavior()
    if errors:
        print(f"AR-02 LOCAL ISOLATION GATE: FAIL ({len(errors)} errors across {checks} checks)")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"AR-02 LOCAL ISOLATION GATE: PASS ({checks} checks)")
    print(f"parent_commit={PARENT}")
    print("mode=LOCAL_ZERO_COST")
    print("network_used=false")
    print("provider_api_key_used=false")
    print("cloud_isolation=PENDING")
    print("production_authority=false")
    print("full_product_connection=NOT_PROVEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
