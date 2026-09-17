#!/usr/bin/env python3
"""Fail-closed local verifier for the AR-00/AR-01 design freeze.

This script performs no writes and grants no implementation or deployment
authority. It proves that the design artifacts remain internally consistent and
that protected source trees still match the recovery base.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
RECOVERY = ROOT / "docs" / "axiom_recovery"
BASE = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
EXPECTED_BRANCH = "frontier/axiom-recovery-ar00-ar01-20260917"
ALLOWED_CHANGED_PREFIXES = ("docs/axiom_recovery/", ".github/scripts/axiom_recovery_ar00_ar01_verify.py")

ERRORS: list[str] = []
CHECKS = 0


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        ERRORS.append(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        ERRORS.append(f"cannot load {path.relative_to(ROOT)}: {exc}")
        return {}
    check(isinstance(value, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return value if isinstance(value, dict) else {}


def git(*args: str, check_return: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check_return and result.returncode != 0:
        ERRORS.append(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def recursive_true_key(value: Any, key: str, trail: str = "$") -> list[str]:
    hits: list[str] = []
    if isinstance(value, dict):
        for child_key, child in value.items():
            child_trail = f"{trail}.{child_key}"
            if child_key == key and child is True:
                hits.append(child_trail)
            hits.extend(recursive_true_key(child, key, child_trail))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            hits.extend(recursive_true_key(child, key, f"{trail}[{index}]"))
    return hits


def verify_repository_scope(authority: dict[str, Any]) -> None:
    branch = git("branch", "--show-current").stdout.strip()
    check(branch == EXPECTED_BRANCH, f"unexpected recovery branch: {branch!r}")

    ancestry = git("merge-base", "--is-ancestor", BASE, "HEAD", check_return=False)
    check(ancestry.returncode == 0, "recovery base is not an ancestor of HEAD")

    status = git("status", "--porcelain", "--untracked-files=all").stdout.splitlines()
    for line in status:
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        check(path.startswith(ALLOWED_CHANGED_PREFIXES), f"out-of-scope working-tree change: {path}")

    tree_paths = {
        "axiom_interface": "c9aa15f2cde244e1669f75ca314fcfb4ae8e8da2",
        "axiom_interface/vnext": "7b9a3f6d485a03b17945e7fd12e120631c56a257",
        "frontier_v5": "b4478c2e462126568dbf34f1f5b40ecc29da24ed",
        "frontier_review_safe": "5c8bda7a41af7f9eb7b4b0a9e1c5cd9ab0207423",
        "mcp": "1ca86d943145df743d5eff5e58a8c46052478de0",
        "auth": "d2814277d6b3a9c12bb0332e4acfd44ccfc9dcd4",
        "ops": "ff8527fbc7864fe880745db3813499fb67adab5c",
        "docs/axiom_final_product": "dac3acb632c1772d0377b93e41e37c02af63539d",
        ".github/workflows": "208e1b5725a355a8d927af40c3dca98193641edc",
    }
    frozen = authority.get("frozen_git_trees", {})
    for path, expected in tree_paths.items():
        actual = git("rev-parse", f"HEAD:{path}").stdout.strip()
        check(actual == expected, f"protected tree changed: {path} is {actual}, expected {expected}")
        key = {
            "axiom_interface": "axiom_interface",
            "axiom_interface/vnext": "axiom_interface_vnext",
            "frontier_v5": "frontier_v5",
            "frontier_review_safe": "frontier_review_safe",
            "mcp": "mcp",
            "auth": "auth",
            "ops": "ops",
            "docs/axiom_final_product": "final_product_docs",
            ".github/workflows": "github_workflows",
        }[path]
        check(frozen.get(key) == expected, f"authority freeze has wrong tree for {path}")
        dirty = git("status", "--porcelain", "--", path).stdout.strip()
        check(not dirty, f"protected path has working-tree changes: {path}")


def verify_authority(authority: dict[str, Any]) -> None:
    check(authority.get("schema") == "musitu.axiom.recovery.authority-freeze.v1", "authority schema mismatch")
    check(authority.get("program") == "AXIOM_RECOVERY_BLUEPRINT_V1", "program mismatch")
    check(authority.get("phases") == ["AR-00", "AR-01"], "authorized phases mismatch")

    approval = authority.get("human_approval", {})
    check(
        approval.get("exact_confirmation") == "APPROVE AXIOM RECOVERY BLUEPRINT V1 — START AR-00 AND AR-01",
        "human approval text mismatch",
    )
    for key in (
        "ar02_authorized",
        "implementation_authorized",
        "commit_or_push_authorized",
        "staging_authorized",
        "canary_authorized",
        "production_authorized",
        "database_mutation_authorized",
    ):
        check(approval.get(key) is False, f"{key} must remain false")

    source = authority.get("source_authority", {})
    check(source.get("recovery_base_commit") == BASE, "recovery base commit mismatch")
    check(source.get("sealed_main_commit") == "d6a846f6bbe0bccac1758713eb4de167caf07113", "sealed main mismatch")
    check(source.get("fa20_source_commit") == "21d087f0fdebffd4cfb4065286aa16696fcec9c0", "FA20 source mismatch")
    check(source.get("frontier_v5_commit") == "d9196774a9fff3150922e2cb681d16e2423651da", "Frontier V5 source mismatch")

    for path, expected in authority.get("frozen_file_sha256", {}).items():
        target = ROOT / path
        check(target.is_file(), f"missing frozen file: {path}")
        if target.is_file():
            check(sha256(target) == expected, f"frozen file digest mismatch: {path}")

    claims = authority.get("claim_freeze", {})
    check(claims.get("full_product_connection") == "NOT_PROVEN", "full product connection must remain NOT_PROVEN")
    check(claims.get("frontier_v5_live_integration") == "NOT_PROVEN", "V5 live integration must remain NOT_PROVEN")
    check(claims.get("superiority") == "NOT_CERTIFIED", "superiority must remain NOT_CERTIFIED")
    check(claims.get("tablet_evidence") == "DEFERRED_PENDING_FUTURE_CUSTOMER", "tablet truth changed")


def verify_source_truth() -> None:
    manifest = load_json(ROOT / "frontier_v5" / "MANIFEST.json")
    targets = load_json(ROOT / "frontier_v5" / "CAPABILITY_TARGETS.json")
    check(manifest.get("status") == "development", "Frontier V5 must remain development")
    check(manifest.get("submission_skill_count") == 18, "submission skill count mismatch")
    check(manifest.get("frontier_skill_count") == 12, "frontier skill count mismatch")
    check(manifest.get("capability_matrix_rows") == 110, "Frontier V5 registry count mismatch")
    check(targets.get("counts") == {"openai_public_skill_packages": 44, "public_role_workflows": 36, "musitu_proprietary_targets": 30, "total": 110}, "capability target counts mismatch")
    check("not a claim" in targets.get("status_rule", ""), "target registry status rule weakened")

    surface = load_json(ROOT / "axiom_interface" / "surface-map.json")
    check(surface.get("phase") == "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE", "legacy earned phase changed")
    source_authority = surface.get("authority", {})
    for phase in range(1, 13):
        check(bool(source_authority.get(f"qualified_phase{phase}_sha")), f"missing qualified Phase {phase} source")
    for phase in range(13, 16):
        check(f"qualified_phase{phase}_sha" not in source_authority, f"legacy Phase {phase} was incorrectly promoted")
    check(surface.get("project_substrate", {}).get("cloud_sync_claimed") is False, "browser cloud sync truth changed")
    check(surface.get("project_substrate", {}).get("multi_device_sync_claimed") is False, "multi-device truth changed")

    fa15 = load_json(ROOT / "docs" / "axiom_final_product" / "FA15_ACCEPTANCE_MATRIX.json")
    check(fa15.get("external_execution_authority") is False, "FA15 external execution truth changed")
    check(fa15.get("qualified_scheduler_connected") is False, "FA15 scheduler truth changed")
    check(fa15.get("legacy_phase_15_unchanged") is True, "legacy Phase 15 boundary changed")

    fa16 = load_json(ROOT / "docs" / "axiom_final_product" / "FA16_ACCEPTANCE_MATRIX.json")
    check(fa16.get("real_phone_evidence") == "EVIDENCED", "phone evidence was not preserved")
    check(fa16.get("tablet_evidence") == "DEFERRED_PENDING_FUTURE_CUSTOMER", "tablet evidence was invented")
    check(fa16.get("phase_exit_earned") is False, "FA16 phase exit was incorrectly earned")

    fa19 = load_json(ROOT / "docs" / "axiom_final_product" / "FA19_COMPARISON_PROTOCOL.json")
    check(fa19.get("external_run_receipts_present") == 0, "FA19 external evidence truth changed")
    check(fa19.get("superiority") == "NOT_CERTIFIED", "FA19 superiority boundary changed")

    fa20 = load_json(ROOT / "docs" / "axiom_final_product" / "FA20_RELEASE_MATRIX.json")
    check(fa20.get("phase_exit_earned") is False, "FA20 phase exit was incorrectly earned")
    check(fa20.get("production_authority") is False, "FA20 production authority changed")


def verify_recovery_artifacts(documents: dict[str, dict[str, Any]]) -> None:
    truth = documents["AR00_SYSTEM_TRUTH_REGISTRY.json"]
    check(truth.get("summary", {}).get("single_coherent_product_runtime_exists") is False, "current runtime completeness overstated")
    check(truth.get("summary", {}).get("full_product_connection_proven") is False, "full product connection overstated")
    connections = {row.get("id"): row for row in truth.get("connections", [])}
    required_connections = {
        "CONN_BROWSER_TO_PROJECT_GRAPH": "BROKEN",
        "CONN_VNEXT_TO_DURABLE_ORCHESTRATOR": "BROKEN",
        "CONN_ORCHESTRATOR_TO_FRONTIER_V5": "BROKEN",
        "CONN_ORCHESTRATOR_TO_V3": "LIMITED",
        "CONN_MODEL_TO_EXECUTION": "ABSENT",
        "CONN_STAGING_TO_DATA": "UNSAFE_COUPLING",
        "CONN_UI_TO_REAL_TASK_COMPLETION": "BROKEN",
    }
    for connection_id, state in required_connections.items():
        check(connections.get(connection_id, {}).get("state") == state, f"connection truth mismatch: {connection_id}")

    preservation = documents["AR01_FRONTIER_PRESERVATION_MATRIX.json"]
    policy = preservation.get("policy", {})
    check(policy.get("source_deletion_allowed") is False, "source deletion must remain forbidden")
    check(policy.get("silent_capability_narrowing_allowed") is False, "silent narrowing must remain forbidden")
    phases = preservation.get("legacy_phase_preservation", [])
    check([row.get("phase") for row in phases] == list(range(1, 16)), "legacy Phase 1-15 preservation is incomplete")
    check(all(row.get("authority") == "QUALIFIED" or row.get("phase", 0) >= 12 for row in phases), "qualified Phase 1-11 truth changed")
    check(len(preservation.get("final_app_preservation", [])) == 8, "final-app preservation ranges incomplete")

    version = documents["AR01_VERSION_COMPATIBILITY_MATRIX.json"]
    check(version.get("canonical_platform_id") == "MUSITU_AXIOM_UNIFIED_V1", "canonical platform mismatch")
    check(version.get("version_policy", {}).get("call_target_v6") is False, "unearned V6 label introduced")
    check(len(version.get("canonical_layers", [])) == 8, "canonical architecture must have eight layers")
    check(version.get("environment_contract", {}).get("cross_environment_database_reuse") is False, "cross-environment DB reuse allowed")

    catalog = documents["AR01_CONTRACT_CATALOG.json"]
    check(catalog.get("implementation_status") == "DESIGN_ONLY", "contracts incorrectly claim implementation")
    contract_ids = [row.get("id") for row in catalog.get("contracts", [])]
    required_contracts = {
        "IDENTITY_CONTEXT", "PROJECT_CONTEXT", "TASK_REQUEST", "EXECUTION_PLAN",
        "MODEL_ROUTE_DECISION", "TOOL_DESCRIPTOR", "TOOL_INVOCATION", "APPROVAL_GRANT",
        "STEP_STATE", "TOOL_RECEIPT", "ARTIFACT_MANIFEST", "EVIDENCE_ENVELOPE",
        "TASK_EVENT", "SYNC_CHANGESET", "PROMOTION_ATTESTATION",
    }
    check(required_contracts.issubset(contract_ids), "canonical contract catalog is incomplete")
    check(len(contract_ids) == len(set(contract_ids)), "duplicate contract identifiers")

    acceptance = documents["AR00_AR01_ACCEPTANCE_MATRIX.json"]
    check(len(acceptance.get("criteria", [])) == 13, "acceptance criteria count mismatch")
    check(all(row.get("required") is True for row in acceptance.get("criteria", [])), "an acceptance criterion is not mandatory")
    result = acceptance.get("phase_result_after_successful_local_verification", {})
    check(result.get("implementation_started") is False, "implementation was incorrectly marked started")
    check(result.get("ar02_authorized") is False, "AR-02 was incorrectly authorized")
    check(result.get("production_mutated") is False, "production mutation was incorrectly recorded")
    check(result.get("superiority") == "NOT_CERTIFIED", "acceptance claims superiority")

    for name, document in documents.items():
        hits = recursive_true_key(document, "production_authority")
        check(not hits, f"{name} contains true production_authority at {hits}")

    architecture = (RECOVERY / "AR01_CANONICAL_ARCHITECTURE.md").read_text(encoding="utf-8")
    migration = (RECOVERY / "AR01_MIGRATION_ROLLBACK_PLAN.md").read_text(encoding="utf-8")
    for marker in (
        "Experience clients", "Identity and Task Gateway", "Project / Work Graph",
        "Durable Orchestrator", "Qualified Model Router", "Governed Tool Fabric",
        "Execution planes", "Evidence, artifacts, and observability",
        "Full-connection acceptance trace", "without customer-funded keys",
    ):
        check(marker in architecture, f"architecture missing marker: {marker}")
    for marker in ("AR-02", "First vertical slice", "Data migration method", "Feature preservation ledger", "Rollback hierarchy", "Mandatory fault campaigns", "Additional information required before AR-02"):
        check(marker in migration, f"migration plan missing marker: {marker}")


def main() -> int:
    required_files = [
        "README.md",
        "AR00_AUTHORITY_FREEZE.json",
        "AR00_SYSTEM_TRUTH_REGISTRY.json",
        "AR01_FRONTIER_PRESERVATION_MATRIX.json",
        "AR01_VERSION_COMPATIBILITY_MATRIX.json",
        "AR01_CONTRACT_CATALOG.json",
        "AR01_CANONICAL_ARCHITECTURE.md",
        "AR01_MIGRATION_ROLLBACK_PLAN.md",
        "AR00_AR01_ACCEPTANCE_MATRIX.json",
    ]
    for name in required_files:
        check((RECOVERY / name).is_file(), f"missing recovery artifact: {name}")

    documents = {
        name: load_json(RECOVERY / name)
        for name in required_files
        if name.endswith(".json") and (RECOVERY / name).is_file()
    }
    authority = documents.get("AR00_AUTHORITY_FREEZE.json", {})
    verify_repository_scope(authority)
    verify_authority(authority)
    verify_source_truth()
    verify_recovery_artifacts(documents)

    if ERRORS:
        print(f"AR-00/AR-01 DESIGN GATE: FAIL ({len(ERRORS)} errors across {CHECKS} checks)")
        for error in ERRORS:
            print(f"- {error}")
        return 1

    print(f"AR-00/AR-01 DESIGN GATE: PASS ({CHECKS} checks)")
    print(f"source_commit={BASE}")
    print("implementation_authorized=false")
    print("ar02_authorized=false")
    print("production_authority=false")
    print("full_product_connection=NOT_PROVEN")
    print("superiority=NOT_CERTIFIED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
