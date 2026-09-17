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
    ):
        check(not os.environ.get(name), f"provider credential unexpectedly present in governance verifier: {name}")


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
    check(decision.get("provider_identity_requirement") == "DEDICATED_AXOM_AR02_READ_ONLY_CREDENTIAL_REQUIRED", "dedicated AR-02 read identity gate missing")
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
    verify_provider_workflow_source()
    verify_live_github_state()

    if errors:
        print(f"AR-02 REPOSITORY/PROVIDER GOVERNANCE GATE: FAIL ({len(errors)} errors across {checks} checks)")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"AR-02 REPOSITORY/PROVIDER GOVERNANCE GATE: PASS ({checks} checks)")
    print("verification_scope=INTERNAL_INDEPENDENT_GOVERNANCE_READ_ONLY")
    print("repository_visibility=PUBLIC")
    print("main_protected=false")
    print("provider_workflow_execution=BLOCKED_FAIL_CLOSED")
    print("provider_inventory=NOT_PROVEN")
    print("cloud_isolation=NOT_PROVEN")
    print("ar02_complete=false")
    print("production_authority=false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
