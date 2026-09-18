#!/usr/bin/env python3
"""Builder-side fail-closed verifier for the AR-02 GitLab Free mirror bootstrap."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = "3cc0bd96d5aceb1737cda8b9f789394519cf9678"
SEALED_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNTIME = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
BOOTSTRAP_BRANCH = "frontier/axiom-recovery-ar02-gitlab-mirror-bootstrap-20260918"
EXPECTED_DELTA = {
    ".gitlab-ci.yml",
    "docs/axiom_recovery/AR02_GITLAB_FREE_MIRROR_BOOTSTRAP.json",
    "recovery/ar02/verify_gitlab_mirror_builder.py",
    "recovery/ar02/verify_gitlab_mirror_independent.py",
}
FORBIDDEN_ENV = (
    "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_GLOBAL_API_KEY",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_AR02_READ_TOKEN",
    "CLOUDFLARE_AR02_TOKEN_AUDITOR_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
)


class VerificationError(RuntimeError):
    pass


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(
        list(args),
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and cp.returncode != 0:
        raise VerificationError(
            f"command failed ({cp.returncode}): {' '.join(args)}\n{cp.stdout}\n{cp.stderr}"
        )
    return cp


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def git(*args: str) -> str:
    return run("git", *args).stdout.strip()


def verify_git_history() -> None:
    require(git("rev-parse", "HEAD"), "HEAD missing")
    require(
        run("git", "merge-base", "--is-ancestor", BASE, "HEAD", check=False).returncode == 0,
        "AR-02 V3 base is not an ancestor",
    )
    changed = set(git("diff", "--name-only", f"{BASE}..HEAD").splitlines())
    require(changed == EXPECTED_DELTA, f"bootstrap delta mismatch: {sorted(changed)!r}")

    require(
        run("git", "cat-file", "-e", f"{SEALED_MAIN}^{{commit}}", check=False).returncode == 0,
        "sealed main commit missing from imported history",
    )
    require(
        run("git", "cat-file", "-e", f"{RUNTIME}^{{commit}}", check=False).returncode == 0,
        "runtime authority commit missing from imported history",
    )

    main_remote = git("ls-remote", "origin", "refs/heads/main").split()
    runtime_remote = git(
        "ls-remote", "origin", "refs/heads/frontier/axiom-runtime-connection-20260916"
    ).split()
    require(main_remote and main_remote[0] == SEALED_MAIN, "destination main ref drift")
    require(runtime_remote and runtime_remote[0] == RUNTIME, "destination runtime ref drift")

    branch = os.environ.get("CI_COMMIT_REF_NAME", "")
    if branch:
        require(
            branch == BOOTSTRAP_BRANCH
            or os.environ.get("CI_PIPELINE_SOURCE") == "merge_request_event"
            or os.environ.get("CI_COMMIT_REF_PROTECTED") == "true",
            f"unexpected GitLab pipeline ref: {branch}",
        )


def verify_private_project_and_secret_boundary() -> None:
    visibility = os.environ.get("CI_PROJECT_VISIBILITY")
    if visibility:
        require(visibility == "private", f"GitLab project is not private: {visibility}")

    leaked = [name for name in FORBIDDEN_ENV if os.environ.get(name)]
    require(not leaked, f"provider/model secrets unexpectedly present: {leaked!r}")


def verify_bootstrap_contract() -> None:
    path = ROOT / "docs" / "axiom_recovery" / "AR02_GITLAB_FREE_MIRROR_BOOTSTRAP.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    require(
        data.get("schema") == "musitu.axiom.recovery.ar02-gitlab-free-mirror-bootstrap.v1",
        "GitLab bootstrap schema mismatch",
    )
    authority = data["authority"]
    require(authority["sealed_main_commit"] == SEALED_MAIN, "sealed main authority drift")
    require(authority["runtime_source_commit"] == RUNTIME, "runtime authority drift")
    require(authority["ar02_v3_commit"] == BASE, "AR-02 V3 authority drift")
    require(authority["bootstrap_branch"] == BOOTSTRAP_BRANCH, "bootstrap branch drift")

    transition = data["authority_transition"]
    require(transition["github_remains_historical_source_authority"] is True, "GitHub source authority lost")
    require(transition["github_main_modified"] is False, "contract claims GitHub main mutation")
    require(transition["github_pr1_modified"] is False, "contract claims PR #1 mutation")
    require(transition["production_modified"] is False, "contract claims production mutation")

    boundary = data["claim_boundary"]
    require(boundary["gitlab_project_exists"] == "NOT_PROVEN", "GitLab project existence overstated")
    require(boundary["gitlab_branch_protection_enforced"] is False, "branch protection overstated")
    require(boundary["gitlab_ci_executed"] is False, "GitLab CI execution overstated")
    require(boundary["ar02_complete"] is False, "AR-02 completion overstated")
    require(boundary["production_mutated"] is False, "production mutation overstated")


def verify_ci_source() -> None:
    text = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
    require(
        "python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254"
        in text,
        "GitLab CI image is not immutably pinned",
    )
    for forbidden in ("wrangler deploy", "api.cloudflare.com", "CLOUDFLARE_GLOBAL_API_KEY", "environment:"):
        require(forbidden not in text, f"forbidden GitLab CI surface present: {forbidden}")
    require("ar02-builder:" in text, "builder job missing")
    require("ar02-independent-verifier:" in text, "independent verifier job missing")
    require("CI_PIPELINE_SOURCE == \"merge_request_event\"" in text, "MR pipeline rule missing")
    require("CI_COMMIT_REF_PROTECTED == \"true\"" in text, "protected-ref pipeline rule missing")


def execute_local_checks() -> None:
    run(sys.executable, "-m", "unittest", "recovery.ar02.tests.test_ar02_isolation", "-v")
    run(
        sys.executable,
        "recovery/ar02/verify_artifact_crypto_separation.py",
        "--mode",
        "no-regression",
    )
    run(sys.executable, "-m", "py_compile",
        "recovery/ar02/verify_gitlab_mirror_builder.py",
        "recovery/ar02/verify_gitlab_mirror_independent.py",
        "recovery/ar02/verify_artifact_crypto_separation.py",
    )
    run("git", "diff", "--check")


def main() -> int:
    try:
        verify_git_history()
        verify_private_project_and_secret_boundary()
        verify_bootstrap_contract()
        verify_ci_source()
        execute_local_checks()
    except (VerificationError, OSError, json.JSONDecodeError) as exc:
        print(f"AR-02 GITLAB MIRROR BUILDER: FAIL: {exc}", file=sys.stderr)
        return 1

    print("AR-02 GITLAB MIRROR BUILDER: PASS")
    print(f"sealed_main={SEALED_MAIN}")
    print(f"runtime_authority={RUNTIME}")
    print(f"ar02_v3_base={BASE}")
    print("provider_execution_performed=false")
    print("production_mutated=false")
    print("ar02_complete=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
