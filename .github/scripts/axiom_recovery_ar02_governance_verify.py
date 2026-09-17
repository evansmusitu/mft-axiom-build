#!/usr/bin/env python3
"""Independent fail-closed verifier for the AR-02 repository/provider gate.

This verifier performs only read-only GitHub metadata requests and repository
file inspection. It never reads Cloudflare secrets, never calls Cloudflare,
never mutates GitHub settings, and never grants production authority.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "evansmusitu/mft-axiom-build"
SEALED_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNTIME_SOURCE = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
RECOVERY_PARENT = "48689a9e4b652f13c9a8acabfb0b9484a671c7d6"
GATE_PATH = ROOT / "docs" / "axiom_recovery" / "AR02_REPOSITORY_PROVIDER_GATE.json"
CREDENTIAL_PATH = ROOT / "docs" / "axiom_recovery" / "AR02_CLOUDFLARE_CREDENTIAL_CONTRACT.json"
PROVIDER_WORKFLOW = ROOT / ".github" / "workflows" / "axiom-recovery-ar02-provider-readonly.yml"

errors: list[str] = []
checks = 0


def check(value: bool, message: str) -> None:
    global checks
    checks += 1
    if not value:
        errors.append(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load {path.relative_to(ROOT)}: {exc}")
        return {}
    check(isinstance(value, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return value if isinstance(value, dict) else {}


def github_get(path: str) -> Any:
    url = "https://api.github.com" + path
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "musitu-axiom-ar02-governance-verifier/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            check(response.status == 200, f"GitHub GET {path} returned HTTP {response.status}")
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        errors.append(f"GitHub read failed for {path}: {type(exc).__name__}: {exc}")
        return None


def verify_no_provider_secret_context() -> None:
    for name in (
        "CLOUDFLARE_EMAIL",
        "CLOUDFLARE_GLOBAL_API_KEY",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_AR02_READ_TOKEN",
        "CLOUDFLARE_AR02_TOKEN_ID",
        "CLOUDFLARE_AR02_TOKEN_AUDITOR_TOKEN",
        "CLOUDFLARE_AR02_INVENTORY_TOKEN_ID",
    ):
        check(not os.environ.get(name), f"provider credential or identifier unexpectedly present in governance verifier: {name}")


def verify_gate_contract() -> dict[str, Any]:
    gate = load_json(GATE_PATH)
    check(gate.get("schema") == "musitu.axiom.recovery.ar02-repository-provider-gate.v1", "gate schema mismatch")
    check(gate.get("phase") == "AR-02", "gate phase mismatch")

    authority = gate.get("authority", {})
    check(authority.get("sealed_main_commit") == SEALED_MAIN, "sealed main authority mismatch")
    check(authority.get("runtime_source_commit") == RUNTIME_SOURCE, "runtime source authority mismatch")
    check(authority.get("recovery_parent_commit") == RECOVERY_PARENT, "recovery parent authority mismatch")
    check(authority.get("pr_1_required_state") == "OPEN_DRAFT_UNMERGED", "PR #1 required state weakened")

    observed = gate.get("observed_repository_state", {})
    check(observed.get("visibility") == "PUBLIC", "repository visibility snapshot must remain PUBLIC until actually changed")
    check(observed.get("main_branch_protected") is False, "main protection snapshot overstated")
    check(observed.get("repository_rulesets") == [], "repository ruleset snapshot overstated")
    check(observed.get("pr_1_open") is True, "PR #1 open snapshot mismatch")
    check(observed.get("pr_1_draft") is True, "PR #1 draft snapshot mismatch")
    check(observed.get("pr_1_merged") is False, "PR #1 merged snapshot mismatch")

    decision = gate.get("decision", {})
    check(decision.get("repository_privacy_requirement") == "PRIVATE_REQUIRED_BEFORE_PROVIDER_SECRET_WORKFLOW", "private-repository provider gate missing")
    check(decision.get("main_protection_requirement") == "PROTECTION_OR_EQUIVALENT_RULESET_REQUIRED_BEFORE_RELEASE_PATH", "main protection gate missing")
    check(decision.get("provider_identity_requirement") == "DEDICATED_AXIOM_AR02_READ_ONLY_CREDENTIAL_REQUIRED", "dedicated AR-02 read identity gate missing")
    check(decision.get("cross_product_secret_reuse") == "FORBIDDEN", "cross-product secret reuse was not forbidden")
    check(decision.get("global_api_key_substitution_for_ar02_read_identity") == "FORBIDDEN", "broad global key substitution was not forbidden")
    check(decision.get("provider_workflow_execution") == "BLOCKED_FAIL_CLOSED", "provider workflow was prematurely authorized")
    check(decision.get("production_authority") is False, "governance gate claimed production authority")

    provider = gate.get("provider_workflow", {})
    check(provider.get("path") == ".github/workflows/axiom-recovery-ar02-provider-readonly.yml", "provider workflow path mismatch")
    check(provider.get("required_repository_visibility") == "PRIVATE", "provider workflow does not require private repository")
    check(set(provider.get("required_secret_names", [])) == {"CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AR02_READ_TOKEN"}, "provider required-secret contract mismatch")
    check(provider.get("optional_secret_names") == ["CLOUDFLARE_AR02_TOKEN_ID"], "provider optional-secret contract mismatch")
    check(provider.get("allowed_http_methods") == ["GET"], "provider workflow is not GET-only")
    check(provider.get("provider_mutation_enabled") is False, "provider mutation was enabled")

    earned = gate.get("earned_evidence", {})
    check(earned.get("provider_readonly_harness_repository_gate") == "PASS", "qualified provider harness result missing")
    check(earned.get("independent_repository_verifier") == "PASS", "independent repository verifier result missing")
    for key in (
        "provider_control_plane_inventory",
        "account_plan",
        "account_wide_free_tier_headroom",
        "staging_provider_identities",
        "canary_provider_identities",
        "nonproduction_credential_cannot_mutate_production",
    ):
        check(earned.get(key) == "NOT_PROVEN", f"external provider claim overstated: {key}")
    check(earned.get("cloud_restore_drill") == "NOT_PERFORMED", "cloud restore drill overstated")

    boundary = gate.get("claim_boundary", {})
    check(boundary.get("ar02_complete") is False, "AR-02 completion overstated")
    check(boundary.get("cloud_isolation") == "NOT_PROVEN", "cloud isolation overstated")
    check(boundary.get("runtime_rebound_off_production_d1") is False, "runtime rebound overstated")
    check(boundary.get("production_mutated") is False, "production mutation claim invalid")
    check(boundary.get("billing_mutated") is False, "billing mutation claim invalid")
    check(boundary.get("full_product_connection") == "NOT_PROVEN", "full-product connection overstated")
    check(boundary.get("superiority") == "NOT_CERTIFIED", "superiority overstated")
    return gate


def verify_credential_contract() -> None:
    contract = load_json(CREDENTIAL_PATH)
    check(contract.get("schema") == "musitu.axiom.recovery.ar02-cloudflare-credential-contract.v1", "credential contract schema mismatch")
    check(contract.get("phase") == "AR-02", "credential contract phase mismatch")
    check(contract.get("status") == "DESIGN_FROZEN_NOT_PROVISIONED", "credential contract was prematurely provisioned")
    check(contract.get("production_authority") is False, "credential contract claimed production authority")
    check(contract.get("billing_mutation_authorized") is False, "credential contract authorized billing mutation")
    check(contract.get("cross_product_secret_reuse") == "FORBIDDEN", "credential contract allows cross-product secret reuse")
    check(contract.get("global_api_key_use") == "FORBIDDEN", "credential contract allows a global API key")

    scope = contract.get("account_scope", {})
    check(scope.get("mode") == "EXACT_AXIOM_CLOUDFLARE_ACCOUNT_ONLY", "credential account scope is not exact AXIOM account only")
    check(scope.get("account_id_runtime_binding") == "CLOUDFLARE_ACCOUNT_ID", "credential account binding variable mismatch")
    check(scope.get("include_all_accounts") is False, "credential contract includes all accounts")

    inventory = contract.get("inventory_identity", {})
    check(inventory.get("github_secret_name") == "CLOUDFLARE_AR02_READ_TOKEN", "inventory secret binding mismatch")
    required_inventory = {
        "D1 Read",
        "Workers R2 Storage Read",
        "Queues Read",
        "Workers Scripts Read",
        "Billing Read",
    }
    check(set(inventory.get("required_account_permissions_exact", [])) == required_inventory, "inventory token permissions are not the exact frozen read-only set")
    check("Account API Tokens Read" not in set(inventory.get("required_account_permissions_exact", [])), "inventory token improperly contains token-policy read permission")
    forbidden = set(inventory.get("forbidden_permission_classes", []))
    for marker in (
        "D1 Write",
        "D1 Edit",
        "Workers R2 Storage Write",
        "Workers R2 Storage Edit",
        "Queues Write",
        "Queues Edit",
        "Workers Scripts Write",
        "Workers Scripts Edit",
        "Billing Write",
        "Billing Edit",
        "Account API Tokens Write",
        "Account API Tokens Edit",
    ):
        check(marker in forbidden, f"missing forbidden inventory permission: {marker}")
    inventory_ttl = inventory.get("ttl_policy", {})
    check(inventory_ttl.get("expires_on_required") is True, "inventory token expiry is not mandatory")
    check(isinstance(inventory_ttl.get("maximum_lifetime_seconds"), int) and 0 < inventory_ttl["maximum_lifetime_seconds"] <= 7200, "inventory token TTL exceeds frozen maximum")
    check(inventory_ttl.get("open_ended_token_allowed") is False, "open-ended inventory token allowed")
    check(inventory.get("provider_methods_allowed") == ["GET"], "inventory identity is not GET-only")
    check(set(inventory.get("provider_methods_forbidden", [])) == {"POST", "PUT", "PATCH", "DELETE"}, "inventory mutation methods are not fully forbidden")

    auditor = contract.get("token_policy_auditor_identity", {})
    check(auditor.get("github_secret_name") == "CLOUDFLARE_AR02_TOKEN_AUDITOR_TOKEN", "auditor secret binding mismatch")
    check(auditor.get("inventory_token_id_binding") == "CLOUDFLARE_AR02_INVENTORY_TOKEN_ID", "auditor token-id binding mismatch")
    check(auditor.get("required_account_permissions_exact") == ["Account API Tokens Read"], "auditor permission is not exactly Account API Tokens Read")
    check(auditor.get("forbidden_additional_permissions") is True, "auditor allows additional permissions")
    auditor_ttl = auditor.get("ttl_policy", {})
    check(auditor_ttl.get("expires_on_required") is True, "auditor token expiry is not mandatory")
    check(isinstance(auditor_ttl.get("maximum_lifetime_seconds"), int) and 0 < auditor_ttl["maximum_lifetime_seconds"] <= 7200, "auditor token TTL exceeds frozen maximum")
    check(auditor_ttl.get("open_ended_token_allowed") is False, "open-ended auditor token allowed")
    check(auditor.get("may_read_token_secret_value") is False, "auditor may read a token secret value")
    check(auditor.get("may_create_edit_revoke_tokens") is False, "auditor may mutate tokens")
    check(auditor.get("provider_methods_allowed") == ["GET"], "auditor identity is not GET-only")

    separation = contract.get("separation_of_duties", {})
    for key in (
        "inventory_token_must_not_have_account_api_tokens_read",
        "auditor_token_must_not_have_product_or_billing_permissions",
        "inventory_and_auditor_tokens_must_be_distinct",
        "inventory_token_policy_verified_by_separate_auditor_identity",
    ):
        check(separation.get(key) is True, f"credential separation invariant missing: {key}")
    check(separation.get("builder_self_certification_allowed") is False, "credential contract allows builder self-certification")

    endpoints = contract.get("read_endpoints_and_minimum_permissions", [])
    check(isinstance(endpoints, list) and len(endpoints) == 7, "credential endpoint map must contain exactly seven frozen reads")
    for row in endpoints if isinstance(endpoints, list) else []:
        check(row.get("method") == "GET", f"credential endpoint is not GET-only: {row.get('path')}")
    endpoint_permissions = {(row.get("path"), row.get("permission")) for row in endpoints if isinstance(row, dict)}
    required_endpoint_permissions = {
        ("/accounts/{account_id}/d1/database", "D1 Read"),
        ("/accounts/{account_id}/r2/buckets", "Workers R2 Storage Read"),
        ("/accounts/{account_id}/queues", "Queues Read"),
        ("/accounts/{account_id}/workflows", "Workers Scripts Read"),
        ("/accounts/{account_id}/subscriptions", "Billing Read"),
        ("/accounts/{account_id}/tokens/verify", "TOKEN_SELF_VERIFY"),
        ("/accounts/{account_id}/tokens/{inventory_token_id}", "Account API Tokens Read"),
    }
    check(endpoint_permissions == required_endpoint_permissions, "credential endpoint/permission map drifted")

    transition = contract.get("current_harness_transition", {})
    check(transition.get("self_introspection_with_inventory_identity_allowed") is False, "inventory identity may self-certify its permission policy")
    check(transition.get("required_change_before_scope_certification") == "MOVE_TOKEN_POLICY_READBACK_TO_A_SEPARATE_AUDITOR_IDENTITY", "separate token-policy auditor migration requirement missing")
    check(transition.get("provider_execution_currently_blocked_by_public_repository") is True, "public-repository provider block was removed")

    headroom = contract.get("headroom_boundary", {})
    check(headroom.get("billing_read_can_prove_subscription_state") is True, "Billing Read subscription capability missing")
    check(headroom.get("billing_read_alone_proves_account_wide_free_tier_headroom") is False, "Billing Read incorrectly treated as headroom proof")
    check(headroom.get("account_wide_free_tier_headroom") == "NOT_PROVEN", "account-wide free-tier headroom overstated")
    check(headroom.get("additional_usage_evidence_required") is True, "additional usage evidence requirement missing")

    boundary = contract.get("claim_boundary", {})
    for key in ("credentials_created", "credentials_brokered_to_github", "credential_scope_verified", "provider_inventory_executed", "ar02_complete", "production_mutated"):
        check(boundary.get(key) is False, f"credential claim boundary must keep {key}=false")
    check(boundary.get("account_wide_free_tier_headroom") == "NOT_PROVEN", "credential contract overstated headroom")
    check(boundary.get("cloud_isolation") == "NOT_PROVEN", "credential contract overstated cloud isolation")
    check(boundary.get("superiority") == "NOT_CERTIFIED", "credential contract overstated superiority")


def verify_provider_workflow_source() -> None:
    try:
        source = PROVIDER_WORKFLOW.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"cannot read provider workflow: {exc}")
        return
    check("github.event.repository.private" in source, "provider workflow lacks private-repository fail-close")
    check("CLOUDFLARE_AR02_READ_TOKEN" in source, "provider workflow lacks dedicated AR-02 read token")
    check("CLOUDFLARE_ACCOUNT_ID" in source, "provider workflow lacks explicit account binding")
    check("CLOUDFLARE_GLOBAL_API_KEY" not in source, "provider workflow accepts broad global API key")
    check("CLOUDFLARE_EMAIL" not in source, "provider workflow accepts global-key email identity")
    check("wrangler deploy" not in source, "provider workflow contains deployment surface")
    check("upload-artifact" not in source, "provider workflow persists provider evidence as an artifact")


def verify_live_github_state() -> None:
    repo = github_get(f"/repos/{REPOSITORY}")
    if isinstance(repo, dict):
        check(repo.get("visibility") == "public" and repo.get("private") is False, "live repository visibility no longer matches frozen PUBLIC snapshot")
        check(repo.get("default_branch") == "main", "unexpected default branch")

    main = github_get(f"/repos/{REPOSITORY}/branches/main")
    if isinstance(main, dict):
        check(main.get("protected") is False, "live main protection state no longer matches frozen snapshot")
        commit = main.get("commit") or {}
        check(commit.get("sha") == SEALED_MAIN, "live main SHA drifted from sealed authority")

    runtime = github_get(f"/repos/{REPOSITORY}/branches/frontier/axiom-runtime-connection-20260916")
    if isinstance(runtime, dict):
        commit = runtime.get("commit") or {}
        check(commit.get("sha") == RUNTIME_SOURCE, "live runtime source SHA drifted")

    pr = github_get(f"/repos/{REPOSITORY}/pulls/1")
    if isinstance(pr, dict):
        check(pr.get("state") == "open", "PR #1 is no longer open")
        check(pr.get("draft") is True, "PR #1 is no longer draft")
        check(pr.get("merged_at") is None, "PR #1 was merged")
        base = pr.get("base") or {}
        check(base.get("ref") == "main" and base.get("sha") == SEALED_MAIN, "PR #1 base authority drifted")

    rulesets = github_get(f"/repos/{REPOSITORY}/rulesets")
    if isinstance(rulesets, list):
        check(rulesets == [], "live repository rulesets no longer match frozen empty snapshot")


def main() -> int:
    verify_no_provider_secret_context()
    verify_gate_contract()
    verify_credential_contract()
    verify_provider_workflow_source()
    verify_live_github_state()

    if errors:
        print(f"AR-02 REPOSITORY/PROVIDER GOVERNANCE GATE: FAIL ({len(errors)} errors across {checks} checks)")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"AR-02 REPOSITORY/PROVIDER GOVERNANCE GATE: PASS ({checks} checks)")
    print("verification_scope=INTERNAL_INDEPENDENT_GOVERNANCE_READ_ONLY")
    print("credential_design=TWO_IDENTITY_LEAST_PRIVILEGE_FROZEN_NOT_PROVISIONED")
    print("repository_visibility=PUBLIC")
    print("main_protected=false")
    print("provider_workflow_execution=BLOCKED_FAIL_CLOSED")
    print("provider_inventory=NOT_PROVEN")
    print("credential_scope=NOT_PROVEN")
    print("account_wide_free_tier_headroom=NOT_PROVEN")
    print("cloud_isolation=NOT_PROVEN")
    print("ar02_complete=false")
    print("production_authority=false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
