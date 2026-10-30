#!/usr/bin/env python3
"""Independent-source verifier for the isolated AR-03--AR-06 candidate.

This verifier does not import the candidate implementation. It parses source and
status artifacts, invokes the test suite in a child process, and—when run inside
the repository—recomputes ancestry, file-delta, and protected-runtime blob facts.
"""

from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BASE_COMMIT = "7f8b51ddd426aa6c4b7684a67be1960db42028ee"
EXPECTED_BRANCH = "frontier/axiom-recovery-ar03-ar06-candidate-20260919"
STATUS_PATH = "docs/axiom_recovery/AR03_AR06_CANDIDATE_STATUS_20260919.json"
PROTECTED_RUNTIME_BLOBS = {
    "axiom_interface/vnext/runtime_task_service.mjs": "dc847eef5d2907d4d3826f7802050ea4e388ad1c",
    "axiom_interface/vnext/identity_session_adapter.js": "1f604097fde1c70a48fc621058a4b9edc4402b30",
    "axiom_interface/vnext/project_work_memory_bridge.js": "cacadac65d6231d76a83f04d9bb4863b16f4b7d1",
    "axiom_interface/vnext/authorization_gateway.js": "41362fb8ed63d182fd44d3d516f79bddebd0d47e",
    "axiom_interface/vnext/capability_router_v2.js": "679417c52d94a679d538a0d07ac15878236f1744",
    "axiom_interface/vnext/execution_store.js": "78b86537b3cff58f8538377fca49e7cf83030c80",
    "axiom_interface/vnext/execution_security.js": "bf7e001cdc45b10a695607c42b5bac922342574e",
    "axiom_interface/vnext/fa18_axiom_build_challenge.mjs": "e4803d3a11dcb8a8519ed3b83df2ab95ad6af08e",
    "axiom_interface/vnext/fa19_external_comparison.mjs": "0ffb572a4fd67415758f81b7f3775784901878e5",
    "axiom_interface/vnext/fa20_release_orchestrator.mjs": "11912c1d6a3eac3c568f1f3fa9aaa9d12ddd0887",
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(command):
    return subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def literal_assignment(path, name):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"), filename=path)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise AssertionError(f"missing literal assignment: {path}:{name}")


def verify_git_context():
    inside = run(["git", "rev-parse", "--is-inside-work-tree"])
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return {
            "status": "NOT_AVAILABLE_LOCAL_SOURCE_ONLY",
            "protected_runtime_blobs": "NOT_RECOMPUTED",
        }
    ancestry = run(["git", "merge-base", "--is-ancestor", BASE_COMMIT, "HEAD"])
    require(ancestry.returncode == 0, "candidate does not descend from exact AR-02 parent")
    branch = run(["git", "branch", "--show-current"])
    branch_name = branch.stdout.strip()
    if branch_name:
        require(branch_name == EXPECTED_BRANCH, "unexpected candidate branch")
    changed = run(["git", "diff", "--name-only", f"{BASE_COMMIT}..HEAD"])
    require(changed.returncode == 0, changed.stdout)
    changed_files = [item for item in changed.stdout.splitlines() if item]
    for path in changed_files:
        require(
            path == ".gitlab-ci.yml"
            or path == STATUS_PATH
            or path == "recovery/__init__.py"
            or path.startswith("recovery/ar03_06/"),
            f"out-of-scope path changed: {path}",
        )
    for path, expected_sha in PROTECTED_RUNTIME_BLOBS.items():
        result = run(["git", "rev-parse", f"HEAD:{path}"])
        require(result.returncode == 0, f"protected runtime file missing: {path}")
        require(result.stdout.strip() == expected_sha, f"protected runtime drift: {path}")
    return {
        "status": "PASS",
        "branch": branch_name or "DETACHED_HEAD",
        "base_commit": BASE_COMMIT,
        "changed_files": changed_files,
        "protected_runtime_blobs": "PASS",
        "protected_runtime_blob_count": len(PROTECTED_RUNTIME_BLOBS),
    }


def main():
    required = [
        "recovery/ar03_06/common.py",
        "recovery/ar03_06/store.py",
        "recovery/ar03_06/identity.py",
        "recovery/ar03_06/graph.py",
        "recovery/ar03_06/kernel.py",
        "recovery/ar03_06/fabric.py",
        "recovery/ar03_06/runtime.py",
        STATUS_PATH,
    ]
    for path in required:
        require((ROOT / path).is_file(), f"required candidate file missing: {path}")

    status = json.loads((ROOT / STATUS_PATH).read_text(encoding="utf-8"))
    require(status["authority"]["authorized_scope"] == "AR-03 THROUGH AR-06 CANDIDATE TRACK ONLY", "scope drift")
    require(status["authority"]["ar02_bootstrap_parent_commit"] == BASE_COMMIT, "base drift")
    require(status["authority"]["production_authority"] is False, "production authority overclaim")
    for phase in ("AR-03", "AR-04", "AR-05", "AR-06"):
        require(status["phases"][phase]["formal_gate"] == "NOT_EARNED", f"{phase} overclaim")
    claims = status["claim_boundary"]
    require(claims["ar02_complete"] is False, "AR-02 completion overclaim")
    require(
        all(claims[f"ar0{number}_earned"] is False for number in range(3, 7)),
        "earned-credit overclaim",
    )
    require(claims["superiority"] == "NOT_CERTIFIED", "superiority overclaim")
    require(claims["full_product_connection"] == "NOT_PROVEN", "connection overclaim")
    require(claims["provider_or_production_mutated"] is False, "provider mutation drift")

    operations = literal_assignment("recovery/ar03_06/fabric.py", "ATOMIC_OPERATIONS")
    lanes = literal_assignment("recovery/ar03_06/fabric.py", "LANE_ORDER")
    require(len(operations) == 74 and len(set(operations)) == 74, "atomic registry drift")
    require([order for _, order in lanes] == list(range(1, 11)), "lane order drift")
    require(len({lane for lane, _ in lanes}) == 10, "duplicate lane")

    store_source = (ROOT / "recovery/ar03_06/store.py").read_text(encoding="utf-8")
    tables = set(re.findall(r"CREATE TABLE IF NOT EXISTS ([a-z_]+)", store_source))
    required_tables = {
        "users", "organizations", "memberships", "entitlements", "sessions",
        "api_keys", "oauth_links", "recovery_tokens", "audit_events", "projects",
        "graph_entities", "graph_events", "import_keys", "tasks", "task_steps",
        "approval_grants", "task_events", "tool_receipts",
    }
    require(required_tables <= tables, "durable schema table set incomplete")

    identity_source = (ROOT / "recovery/ar03_06/identity.py").read_text(encoding="utf-8")
    kernel_source = (ROOT / "recovery/ar03_06/kernel.py").read_text(encoding="utf-8")
    fabric_source = (ROOT / "recovery/ar03_06/fabric.py").read_text(encoding="utf-8")
    require("def validate_context" in identity_source, "context revalidation missing")
    require("hmac.compare_digest" in identity_source, "context proof comparison missing")
    require("durable step input binding is invalid" in kernel_source, "pre-execution binding missing")
    require("hmac.compare_digest" in kernel_source, "approval HMAC verification missing")
    require("retrieved data cannot authorize a side effect" in fabric_source, "provenance deny missing")
    require("authorization grant schema is invalid" in fabric_source, "grant schema binding missing")

    test_result = run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "recovery/ar03_06/tests",
            "-p",
            "test_*.py",
            "-v",
        ]
    )
    require(test_result.returncode == 0, test_result.stdout)
    require("Ran 16 tests" in test_result.stdout, "unexpected independent test count")

    git_evidence = verify_git_context()
    print(
        json.dumps(
            {
                "schema": "musitu.axiom.recovery.ar03-ar06-independent-verdict.v1",
                "status": "PASS",
                "tests_passed": 16,
                "atomic_registry_count": 74,
                "ordered_lane_count": 10,
                "schema_table_count": len(tables),
                "git_evidence": git_evidence,
                "formal_gates_earned": False,
                "provider_execution_performed": False,
                "production_mutated": False,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {
                    "schema": "musitu.axiom.recovery.ar03-ar06-independent-verdict.v1",
                    "status": "FAIL",
                    "error": f"{type(error).__name__}: {error}",
                },
                sort_keys=True,
            )
        )
        raise SystemExit(1)
