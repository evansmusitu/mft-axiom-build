#!/usr/bin/env python3
"""Fail-closed consistency verifier for the AR-02 acceptance truth artifact.

This verifier reads repository evidence only. It does not access provider secrets,
call Cloudflare, mutate GitHub settings, deploy runtime code, or grant production
authority.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ACCEPTANCE = ROOT / "docs" / "axiom_recovery" / "AR02_ACCEPTANCE_MATRIX.json"
REPOSITORY_GATE = ROOT / "docs" / "axiom_recovery" / "AR02_REPOSITORY_PROVIDER_GATE.json"
CREDENTIAL = ROOT / "docs" / "axiom_recovery" / "AR02_CLOUDFLARE_CREDENTIAL_CONTRACT.json"
PROGRESS = ROOT / "docs" / "axiom_recovery" / "AR02_BINDING_RESTORE_PROGRESS.json"

SEALED_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNTIME_SOURCE = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
RECONCILED_HEAD = "9cd5cd413622425e05695777f4fa47ce27da1e22"

errors: list[str] = []
checks = 0


def check(value: bool, message: str) -> None:
    global checks
    checks += 1
    if not value:
        errors.append(message)


def load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load {path.relative_to(ROOT)}: {exc}")
        return {}
    check(isinstance(value, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return value if isinstance(value, dict) else {}


def main() -> int:
    acceptance = load(ACCEPTANCE)
    gate = load(REPOSITORY_GATE)
    credential = load(CREDENTIAL)
    progress = load(PROGRESS)

    check(acceptance.get("schema") == "musitu.axiom.recovery.ar02-acceptance.v2", "acceptance schema mismatch")
    check(acceptance.get("phase") == "AR-02", "acceptance phase mismatch")
    check(acceptance.get("sealed_main_commit") == SEALED_MAIN, "acceptance sealed main mismatch")
    check(acceptance.get("runtime_source_commit") == RUNTIME_SOURCE, "acceptance runtime source mismatch")
    check(acceptance.get("reconciled_from_recovery_head") == RECONCILED_HEAD, "acceptance reconciliation anchor mismatch")
    check(acceptance.get("candidate_state") == "LOCAL_AND_REPOSITORY_GOVERNANCE_QUALIFIED_PROVIDER_ISOLATION_PENDING", "candidate state overstated or drifted")

    earned = acceptance.get("earned_verification", {})
    for key in (
        "local_environment_isolation",
        "s0_s5_approval_schema_alignment",
        "synthetic_non_destructive_restore_drill",
        "snapshot_backup_restore_digest_equivalence",
        "builder_contract_and_restore_gate",
        "internal_independent_repository_verifier",
        "repository_provider_governance_gate",
    ):
        check(earned.get(key) == "PASS", f"earned verification missing: {key}")
    check(earned.get("latest_repository_provider_governance_head") == RECONCILED_HEAD, "governance head mismatch")
    check(earned.get("external_independent_verification") == "NOT_PERFORMED", "external verification overstated")

    plan = acceptance.get("zero_cost_resource_plan", {})
    check(plan.get("account_plan_verified") is False, "account plan overstated")
    check(plan.get("account_wide_free_tier_headroom_verified") is False, "free-tier headroom overstated")
    check(plan.get("dedicated_cloud_resources_created") is False, "cloud resource creation overstated")
    check(plan.get("billing_upgrade_authorized") is False, "billing upgrade authority appeared")
    check(plan.get("billing_mutated") is False, "billing mutation overstated")

    provider = acceptance.get("provider_readonly_foundation", {})
    check(provider.get("http_methods_allowed") == ["GET"], "provider read-only boundary weakened")
    check(provider.get("production_authority") is False, "provider foundation claims production authority")
    check(provider.get("global_api_key_use") == "FORBIDDEN", "global API key use not forbidden")
    check(provider.get("cross_product_secret_reuse") == "FORBIDDEN", "cross-product secret reuse not forbidden")
    check(provider.get("inventory_identity_provisioned") is False, "inventory identity prematurely claimed provisioned")
    check(provider.get("auditor_identity_provisioned") is False, "auditor identity prematurely claimed provisioned")
    check(provider.get("provider_inventory_executed") is False, "provider inventory prematurely claimed executed")

    repo = acceptance.get("repository_governance_state", {})
    check(repo.get("repository_visibility") == "PUBLIC", "acceptance repository visibility must reflect observed public state")
    check(repo.get("repository_private_required_before_provider_secret_workflow") is True, "private-repository provider gate missing")
    check(repo.get("main_branch_protected") is False, "main protection overstated")
    check(repo.get("repository_rulesets_observed") == [], "rulesets overstated")
    check(repo.get("main_protection_or_equivalent_ruleset_required_before_release_path") is True, "main protection requirement missing")
    check(repo.get("current_github_integration_branch_protection_admin_endpoint") == "RESOURCE_NOT_ACCESSIBLE_BY_INTEGRATION", "GitHub administration blocker mismatch")
    check(repo.get("provider_workflow_execution") == "BLOCKED_FAIL_CLOSED", "provider workflow prematurely enabled")

    external = acceptance.get("external_exit_gates", {})
    for key, value in external.items():
        check(value is False, f"external exit gate prematurely passed: {key}")

    legacy = acceptance.get("known_legacy_runtime_defect", {})
    for key in (
        "staging_canary_bound_to_production_d1",
        "remote_schema_execution_against_production_d1",
        "disposable_customer_api_key_fixture_mutation_against_production_d1",
    ):
        check(legacy.get(key) == "PROVEN_FROM_SOURCE", f"legacy defect evidence missing: {key}")
    check(legacy.get("legacy_runtime_workflow_modified_by_recovery") is False, "legacy runtime workflow mutation claim invalid")
    check(legacy.get("legacy_runtime_workflow_reused_for_ar02") is False, "legacy runtime workflow reuse claim invalid")

    boundary = acceptance.get("claim_boundary", {})
    for key in (
        "ar02_complete",
        "runtime_connection_modified",
        "runtime_rebound_off_production_d1",
        "staging_deployed",
        "canary_deployed",
        "production_mutated",
        "production_authority",
    ):
        check(boundary.get(key) is False, f"claim boundary must keep {key}=false")
    check(boundary.get("cloud_isolation") == "NOT_PROVEN", "cloud isolation overstated")
    check(boundary.get("full_product_connection") == "NOT_PROVEN", "full-product connection overstated")
    check(boundary.get("frontier_v5_live_integration") == "NOT_PROVEN", "Frontier V5 live integration overstated")
    check(boundary.get("wolfram_parity") == "NOT_CERTIFIED", "Wolfram parity overstated")
    check(boundary.get("superiority") == "NOT_CERTIFIED", "superiority overstated")

    # Cross-artifact truth consistency.
    observed = gate.get("observed_repository_state", {})
    check(observed.get("visibility") == repo.get("repository_visibility"), "repository visibility disagreement across artifacts")
    check(observed.get("main_branch_protected") == repo.get("main_branch_protected"), "main protection disagreement across artifacts")
    check(observed.get("repository_rulesets") == repo.get("repository_rulesets_observed"), "ruleset disagreement across artifacts")

    credential_boundary = credential.get("claim_boundary", {})
    check(credential_boundary.get("credentials_created") is False, "credential contract says credentials created")
    check(credential_boundary.get("credentials_brokered_to_github") is False, "credential contract says credentials brokered")
    check(credential_boundary.get("provider_inventory_executed") is False, "credential contract says provider inventory executed")
    check(credential_boundary.get("ar02_complete") is False, "credential contract says AR-02 complete")
    check(credential_boundary.get("production_mutated") is False, "credential contract says production mutated")

    progress_boundary = progress.get("authority_and_claim_boundary", {})
    check(progress_boundary.get("ar02_complete") is False, "progress artifact says AR-02 complete")
    check(progress_boundary.get("production_deployed") is False, "progress artifact says production deployed")
    check(progress_boundary.get("production_database_mutated_by_recovery") is False, "progress artifact says production database mutated")
    check(progress_boundary.get("full_product_connection") == "NOT_PROVEN", "progress artifact overstates full-product connection")
    check(progress_boundary.get("superiority") == "NOT_CERTIFIED", "progress artifact overstates superiority")

    if errors:
        print(f"AR-02 ACCEPTANCE TRUTH GATE: FAIL ({len(errors)} errors across {checks} checks)")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"AR-02 ACCEPTANCE TRUTH GATE: PASS ({checks} checks)")
    print("local_and_repository_evidence=QUALIFIED")
    print("provider_inventory=NOT_PROVEN")
    print("cloud_isolation=NOT_PROVEN")
    print("external_independent_verification=NOT_PERFORMED")
    print("ar02_complete=false")
    print("production_authority=false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
