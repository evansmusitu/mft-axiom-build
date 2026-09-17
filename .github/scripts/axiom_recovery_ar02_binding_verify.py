#!/usr/bin/env python3
"""Independent repository-side verifier for AR-02 binding and restore work.

This verifier intentionally does not call the AR-02 builder verifier. It checks
frozen Git authority, the unbound cloud contract, the historical unsafe workflow,
canonical S0-S5 schema truth, the read-only provider evidence harness, and
executes the synthetic restore drill directly. It is internal independent
verification only, not external certification.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "frontier/axiom-recovery-ar02-binding-20260917"
RECOVERY_PARENT = "0be6bee6d7638ef13738f22fc47e0f1b30960a7b"
RUNTIME_SOURCE = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
SEALED_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
ALLOWED = (
    ".github/scripts/axiom_recovery_ar02_binding_verify.py",
    ".github/workflows/axiom-recovery-ar02-binding.yml",
    ".github/workflows/axiom-recovery-ar02-provider-readonly.yml",
    "docs/axiom_recovery/AR02_BINDING_RESTORE_PROGRESS.json",
    "docs/axiom_recovery/AR02_ZERO_COST_RESOURCE_PLAN.json",
    "recovery/ar02/cloud_binding_contract.json",
    "recovery/ar02/provider_inventory_readonly.py",
    "recovery/ar02/restore_drill.py",
)

sys.path.insert(0, str(ROOT))
from recovery.ar02.provider_inventory_readonly import self_test as provider_self_test  # noqa: E402
from recovery.ar02.restore_drill import run_restore_drill  # noqa: E402

errors: list[str] = []
checks = 0


def check(value: bool, message: str) -> None:
    global checks
    checks += 1
    if not value:
        errors.append(message)


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


def load_json(relative: str) -> dict:
    try:
        value = json.loads((ROOT / relative).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot load {relative}: {exc}")
        return {}
    check(isinstance(value, dict), f"{relative} must contain an object")
    return value if isinstance(value, dict) else {}


def verify_git_authority() -> None:
    branch = git("branch", "--show-current")
    name = branch.stdout.strip() or os.environ.get("GITHUB_REF_NAME", "")
    check(branch.returncode == 0 and name == BRANCH, "unexpected binding verification branch")
    check(git("merge-base", "--is-ancestor", RECOVERY_PARENT, "HEAD").returncode == 0, "verified AR-02 parent is not an ancestor")
    changed = git("diff", "--name-only", f"{RECOVERY_PARENT}..HEAD")
    check(changed.returncode == 0, "cannot inspect binding branch changes")
    paths = changed.stdout.splitlines()
    for path in paths:
        check(path in ALLOWED, f"binding branch scope escape: {path}")

    frozen = {
        "axiom_interface": "c9aa15f2cde244e1669f75ca314fcfb4ae8e8da2",
        "axiom_interface/vnext": "7b9a3f6d485a03b17945e7fd12e120631c56a257",
        "frontier_v5": "b4478c2e462126568dbf34f1f5b40ecc29da24ed",
        "frontier_review_safe": "5c8bda7a41af7f9eb7b4b0a9e1c5cd9ab0207423",
        "mcp": "1ca86d943145df743d5eff5e58a8c46052478de0",
        "auth": "d2814277d6b3a9c12bb0332e4acfd44ccfc9dcd4",
        "ops": "ff8527fbc7864fe880745db3813499fb67adab5c",
    }
    for path, expected in frozen.items():
        result = git("rev-parse", f"HEAD:{path}")
        check(result.returncode == 0 and result.stdout.strip() == expected, f"protected tree changed: {path}")

    main = git("rev-parse", "origin/main")
    if main.returncode == 0:
        check(main.stdout.strip() == SEALED_MAIN, "origin/main drifted from sealed authority")


def verify_legacy_truth() -> None:
    legacy = (ROOT / ".github" / "workflows" / "axiom-runtime-connection-staging-canary.yml").read_text(encoding="utf-8")
    required = [
        "D1_NAME: musitu-axiom-prod",
        "D1_UUID: 504029cc-f9a5-495e-818f-63c6144b4ea4",
        "npx wrangler d1 execute \"$D1_NAME\" --remote",
        "INSERT INTO customers",
        "INSERT INTO api_keys",
    ]
    for marker in required:
        check(marker in legacy, f"legacy unsafe binding evidence missing: {marker}")


def verify_binding_contract() -> None:
    contract = load_json("recovery/ar02/cloud_binding_contract.json")
    check(contract.get("schema") == "musitu.axiom.recovery.ar02-cloud-binding-contract.v1", "binding contract schema mismatch")
    check(contract.get("state") == "UNBOUND_PROVIDER_INVENTORY_REQUIRED", "cloud binding was prematurely marked ready")
    check(contract.get("source_runtime_commit") == RUNTIME_SOURCE, "runtime source authority mismatch")
    truth = contract.get("legacy_binding_truth", {})
    for key in (
        "staging_and_canary_share_production_d1",
        "legacy_workflow_executes_schema_against_production_d1",
        "legacy_workflow_creates_disposable_customer_and_api_key_fixtures_in_production_d1",
    ):
        check(truth.get(key) is True, f"legacy risk truth missing: {key}")
    check(truth.get("legacy_workflow_reuse_allowed_for_ar02") is False, "legacy unsafe workflow was re-authorized")

    semantics = contract.get("provider_identity_semantics", {})
    check(semantics.get("d1_database", {}).get("identity_kind") == "UUID", "D1 identity semantics must be UUID")
    check(semantics.get("r2_bucket", {}).get("identity_kind") == "NAME", "R2 identity semantics must be canonical name")
    check(semantics.get("queue", {}).get("identity_kind") == "ID", "Queue identity semantics must be ID")
    check(semantics.get("workflow", {}).get("identity_kind") == "UUID", "Workflow identity semantics must be UUID")
    check("must not fabricate" in semantics.get("r2_bucket", {}).get("note", ""), "R2 no-fabricated-ID rule missing")

    bindings = contract.get("required_non_production_bindings", {})
    check(set(bindings) == {"staging", "canary"}, "binding environments must be staging and canary")
    seen_names: set[str] = set()
    for environment, row in bindings.items():
        expected_prefix = f"musitu-axiom-ar02-{environment}"
        check(row.get("database_name") == expected_prefix, f"{environment} database name mismatch")
        check(row.get("artifact_bucket_name") == expected_prefix + "-artifacts", f"{environment} bucket name mismatch")
        check(row.get("queue_name") == expected_prefix + "-tasks", f"{environment} queue name mismatch")
        check(row.get("workflow_name") == expected_prefix + "-orchestrator", f"{environment} workflow name mismatch")
        check(row.get("identity_audience") == f"urn:musitu:axiom:ar02:{environment}", f"{environment} audience mismatch")
        check(row.get("provider_readback_status") == "NOT_PROVEN", f"{environment} provider readback overstated")
        check(row.get("artifact_bucket_provider_identity_kind") == "NAME", f"{environment} R2 identity kind mismatch")
        check(row.get("artifact_bucket_provider_identity_value") is None, f"{environment} R2 provider identity must remain null before readback")
        for field in ("database_id", "artifact_bucket_id", "queue_id", "workflow_id"):
            check(row.get(field) is None, f"{environment} {field} must remain null until provider readback")
        for field in ("database_name", "artifact_bucket_name", "queue_name", "workflow_name", "identity_audience"):
            value = row.get(field)
            check(isinstance(value, str) and value not in seen_names, f"duplicate or invalid binding value: {field}")
            if isinstance(value, str):
                seen_names.add(value)

    invariants = set(contract.get("binding_invariants", []))
    check("R2_BUCKET_IDENTITY_IS_CANONICAL_NAME_AND_NO_BUCKET_UUID_MAY_BE_FABRICATED" in invariants, "R2 provider identity invariant missing")

    deny = contract.get("production_denylist", {})
    rendered_bindings = json.dumps(bindings).casefold()
    for group in ("database_names", "database_ids", "hostnames"):
        for marker in deny.get(group, []):
            check(str(marker).casefold() not in rendered_bindings, f"production marker leaked into requested binding: {marker}")

    preconditions = contract.get("promotion_preconditions", {})
    check(preconditions and all(value is False for value in preconditions.values()), "a provider/promotion precondition was claimed without evidence")
    boundary = contract.get("claim_boundary", {})
    check(boundary.get("cloud_isolation") == "NOT_PROVEN", "cloud isolation overstated")
    for key in ("runtime_rebound_off_production_d1", "staging_deployed", "canary_deployed", "production_mutated", "ar02_complete"):
        check(boundary.get(key) is False, f"claim boundary must keep {key}=false")


def verify_provider_readonly_harness() -> None:
    source = (ROOT / "recovery" / "ar02" / "provider_inventory_readonly.py").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "axiom-recovery-ar02-provider-readonly.yml").read_text(encoding="utf-8")
    for prohibited in ('method="POST"', 'method="PUT"', 'method="PATCH"', 'method="DELETE"', "wrangler deploy", "wrangler d1 execute", "upload-artifact"):
        check(prohibited not in source, f"provider evidence harness contains mutation/persistence surface: {prohibited}")
    check('method="GET"' in source, "provider evidence harness must pin HTTP GET")
    check("CLOUDFLARE_AR02_READ_TOKEN" in source, "dedicated read-token variable missing")
    check("PASS_READ_ONLY_PROVIDER_HARNESS_SELF_TEST" == provider_self_test().get("status"), "provider evidence harness self-test failed")
    check("github.event.repository.private" in workflow, "provider workflow does not fail closed on public repository")
    check("workflow_dispatch:" in workflow, "provider workflow must be manually dispatched")
    check("upload-artifact" not in workflow, "provider workflow must not persist raw provider evidence as GitHub artifact")
    check("wrangler deploy" not in workflow, "provider evidence workflow contains deploy surface")
    check("CLOUDFLARE_AR02_READ_TOKEN" in workflow, "provider workflow does not use dedicated read-only token name")


def verify_schema_and_restore() -> None:
    schema = (ROOT / "recovery" / "ar02" / "schema" / "0001_project_work_graph.sql").read_text(encoding="utf-8")
    check("risk_class IN ('S0', 'S1', 'S2', 'S3', 'S4', 'S5')" in schema, "approval schema does not encode full S0-S5 governance")
    restore_source = (ROOT / "recovery" / "ar02" / "restore_drill.py").read_text(encoding="utf-8")
    for prohibited in ("urllib", "requests", "http://", "https://", "wrangler deploy", "api.cloudflare.com"):
        check(prohibited not in restore_source, f"restore drill contains prohibited network/deploy surface: {prohibited}")
    with tempfile.TemporaryDirectory(prefix="axiom-ar02-independent-") as directory:
        evidence = run_restore_drill(directory)
        check(evidence.get("status") == "PASS_SYNTHETIC_NON_DESTRUCTIVE_RESTORE", "restore drill did not pass")
        check(evidence.get("snapshot_sha256") == evidence.get("backup_sha256") == evidence.get("restored_sha256"), "snapshot/backup/restore digests diverged")
        check(evidence.get("mutated_source_sha256") != evidence.get("snapshot_sha256"), "fault injection was not observed")
        check(evidence.get("restored_into_separate_root") is True, "restore was not isolated")
        check(evidence.get("source_overwritten") is False, "restore overwrote source")
        check(evidence.get("synthetic_data_only") is True, "restore drill was not synthetic-only")
        check(evidence.get("network_used") is False, "restore drill used network")
        check(evidence.get("provider_credentials_used") is False, "restore drill used provider credentials")
        check(evidence.get("production_authority") is False, "restore drill claimed production authority")
        check(evidence.get("cloud_isolation") == "NOT_PROVEN", "restore drill overstated cloud isolation")


def verify_zero_cost_plan() -> None:
    plan = load_json("docs/axiom_recovery/AR02_ZERO_COST_RESOURCE_PLAN.json")
    gates = set(plan.get("precreation_gates", []))
    check("RESOURCE_CREATION_IS_IDEMPOTENT_AND_READ_BACK_BY_EXACT_PROVIDER_NATIVE_IDENTITY" in gates, "zero-cost plan still requires fabricated generic IDs")
    check(plan.get("resources_created") is False, "zero-cost plan overstated resource creation")
    check(plan.get("billing_mutation_authorized") is False, "zero-cost plan authorized billing mutation")


def verify_progress_claims() -> None:
    path = ROOT / "docs" / "axiom_recovery" / "AR02_BINDING_RESTORE_PROGRESS.json"
    if not path.exists():
        return
    progress = load_json("docs/axiom_recovery/AR02_BINDING_RESTORE_PROGRESS.json")
    check(progress.get("external_independent_verification") == "NOT_PERFORMED", "external independent verification overstated")
    check(progress.get("cloud_provider_inventory") == "NOT_PROVEN", "provider inventory overstated")
    check(progress.get("ar02_complete") is False, "AR-02 completion overstated")
    check(progress.get("production_mutated") is False, "production mutation claim invalid")


def main() -> int:
    verify_git_authority()
    verify_legacy_truth()
    verify_binding_contract()
    verify_provider_readonly_harness()
    verify_schema_and_restore()
    verify_zero_cost_plan()
    verify_progress_claims()
    if errors:
        print(f"AR-02 BINDING/RESTORE INDEPENDENT REPOSITORY GATE: FAIL ({len(errors)} errors across {checks} checks)")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"AR-02 BINDING/RESTORE INDEPENDENT REPOSITORY GATE: PASS ({checks} checks)")
    print("verification_scope=INTERNAL_INDEPENDENT_REPOSITORY_JOB")
    print("provider_readonly_harness=QUALIFIED_NOT_EXECUTED")
    print("external_independent_verification=NOT_PERFORMED")
    print("provider_inventory=NOT_PROVEN")
    print("cloud_isolation=NOT_PROVEN")
    print("production_authority=false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
