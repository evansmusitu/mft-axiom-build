#!/usr/bin/env python3
"""Independent fail-closed verifier for the AR-02 GitLab Free mirror bootstrap."""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = "3cc0bd96d5aceb1737cda8b9f789394519cf9678"
SEALED_MAIN = "d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNTIME = "216ee7d15f01a3fb558452cc4b906a055001ccdd"
EXPECTED_DELTA = {
    ".gitlab-ci.yml",
    "docs/axiom_recovery/AR02_GITLAB_FREE_MIRROR_BOOTSTRAP.json",
    "recovery/ar02/verify_gitlab_mirror_builder.py",
    "recovery/ar02/verify_gitlab_mirror_independent.py",
}
SENSITIVE_ENV = (
    "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_GLOBAL_API_KEY",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_AR02_READ_TOKEN",
    "CLOUDFLARE_AR02_TOKEN_AUDITOR_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
)


def sh(*args: str, ok: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(
        list(args),
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if ok and cp.returncode != 0:
        raise RuntimeError(
            f"command failed ({cp.returncode}): {' '.join(args)}\n{cp.stdout}\n{cp.stderr}"
        )
    return cp


def need(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def git_text(*args: str) -> str:
    return sh("git", *args).stdout.strip()


def tree_paths(commit: str) -> list[str]:
    return git_text("ls-tree", "-r", "--name-only", commit).splitlines()


def show(commit: str, path: str) -> str:
    cp = sh("git", "show", f"{commit}:{path}", ok=False)
    if cp.returncode != 0:
        raise RuntimeError(f"cannot read {commit}:{path}: {cp.stderr}")
    return cp.stdout


def recompute_source_evidence() -> dict[str, object]:
    paths = tree_paths(SEALED_MAIN)
    global_key_paths: list[str] = []
    decrypt_paths: list[str] = []
    hmac_paths: list[str] = []
    explicit_workers_dev: set[str] = set()

    hmac_rx = re.compile(
        r"(?:hmac\.new\(.{0,800}?CLOUDFLARE_GLOBAL_API_KEY|"
        r"CLOUDFLARE_GLOBAL_API_KEY.{0,800}?hmac\.new\()",
        re.I | re.S,
    )
    workers_dev_rx = re.compile(r"['\"]workers_dev['\"]\s*:\s*True")

    for path in paths:
        cp = sh("git", "show", f"{SEALED_MAIN}:{path}", ok=False)
        if cp.returncode != 0:
            continue
        text = cp.stdout
        if "CLOUDFLARE_GLOBAL_API_KEY" in text:
            global_key_paths.append(path)
        if "-pass env:CLOUDFLARE_GLOBAL_API_KEY" in text:
            decrypt_paths.append(path)
        if hmac_rx.search(text):
            hmac_paths.append(path)
        if workers_dev_rx.search(text):
            explicit_workers_dev.add(path)

    public_paths = set(explicit_workers_dev)
    dynamic = ".github/workflows/axiom-modal-edge-isolated-deploy.yml"
    bootstrap_enable = ".github/workflows/cloudflare-axiom-bootstrap-enable.yml"
    bootstrap_deploy = ".github/workflows/cloudflare-axiom-bootstrap.yml"

    dyn_text = show(SEALED_MAIN, dynamic)
    need("c['workers_dev']=True" in dyn_text, "dynamic workers.dev activation evidence missing")
    public_paths.add(dynamic)

    enable_text = show(SEALED_MAIN, bootstrap_enable)
    need('{"enabled":true,"previews_enabled":false}' in enable_text, "bootstrap subdomain activation evidence missing")
    public_paths.add(bootstrap_enable)

    bootstrap_text = show(SEALED_MAIN, bootstrap_deploy)
    need(".workers.dev/health" in bootstrap_text, "bootstrap public health evidence missing")
    public_paths.add(bootstrap_deploy)

    return {
        "all_global_key_paths": sorted(global_key_paths),
        "workflow_global_key_paths": sorted(p for p in global_key_paths if p.startswith(".github/workflows/")),
        "nonworkflow_global_key_paths": sorted(p for p in global_key_paths if not p.startswith(".github/workflows/")),
        "decrypt_paths": sorted(decrypt_paths),
        "hmac_paths": sorted(hmac_paths),
        "workers_dev_paths": sorted(public_paths),
        "explicit_workers_dev_paths": sorted(explicit_workers_dev),
    }


def verify_authority_and_scope() -> None:
    need(sh("git", "merge-base", "--is-ancestor", BASE, "HEAD", ok=False).returncode == 0, "V3 base not ancestor")
    changed = set(git_text("diff", "--name-only", f"{BASE}..HEAD").splitlines())
    need(changed == EXPECTED_DELTA, f"unexpected GitLab bootstrap delta: {sorted(changed)!r}")

    main = git_text("ls-remote", "origin", "refs/heads/main").split()
    runtime = git_text("ls-remote", "origin", "refs/heads/frontier/axiom-runtime-connection-20260916").split()
    need(main and main[0] == SEALED_MAIN, "destination main authority mismatch")
    need(runtime and runtime[0] == RUNTIME, "destination runtime authority mismatch")
    need(not [name for name in SENSITIVE_ENV if os.environ.get(name)], "sensitive provider/model secret present")


def verify_forensic_counts() -> None:
    evidence = recompute_source_evidence()
    need(len(evidence["all_global_key_paths"]) == 164, "repository-wide global-key count mismatch")
    need(len(evidence["workflow_global_key_paths"]) == 158, "workflow global-key count mismatch")
    need(len(evidence["nonworkflow_global_key_paths"]) == 6, "nonworkflow global-key count mismatch")
    need(len(evidence["decrypt_paths"]) == 51, "artifact decrypt key-reuse count mismatch")
    need(len(evidence["hmac_paths"]) == 29, "artifact HMAC key-reuse count mismatch")
    need(len(evidence["explicit_workers_dev_paths"]) == 16, "explicit workers.dev count mismatch")
    need(len(evidence["workers_dev_paths"]) == 19, "workers.dev exposure/activation count mismatch")

    expected_nonworkflow = {
        "ops/axiom_billing_commercial_enable_v1.py",
        "ops/axiom_billing_ingress_deploy.py",
        "ops/axiom_billing_ingress_deploy_v2.py",
        "ops/axiom_billing_status_contract_patch.py",
        "scripts/axiom-staging-deploy.sh",
        "scripts/rollout_oauth_userinfo.py",
    }
    need(set(evidence["nonworkflow_global_key_paths"]) == expected_nonworkflow, "nonworkflow credential surface drift")


def verify_evidence_ledgers() -> None:
    repo = json.loads(
        (ROOT / "docs/axiom_recovery/AR02_CREDENTIAL_SURFACE_REPOSITORY_WIDE_V3.json").read_text()
    )
    need(repo["reconciliation"]["explicit_repository_wide_unique_file_count"] == 164, "V3 repository count drift")
    need(repo["reconciliation"]["repository_wide_source_confirmed_mutation_secret_or_deploy"] == 58, "V3 mutation count drift")
    need(repo["reconciliation"]["runtime_artifact_crypto_reuse_files"] == 51, "V3 crypto count drift")
    need(repo["reconciliation"]["crypto_reuse_and_source_confirmed_mutation_overlap"] == 10, "compound count drift")

    preview = json.loads(
        (ROOT / "docs/axiom_recovery/AR02_WORKERS_DEV_EXPOSURE_MATRIX.json").read_text()
    )
    need(preview["counts"]["public_workers_dev_exposure_or_activation_paths"] == 19, "preview count drift")
    need(preview["counts"]["all_identified_paths_have_ar02_disposition"] is True, "preview dispositions incomplete")
    need(preview["source_vs_provider_truth"]["current_live_cloudflare_exposure"] == "NOT_PROVEN", "live exposure overclaim")

    current = json.loads(
        (ROOT / "docs/axiom_recovery/AR02_CURRENT_STATUS_20260918_V3.json").read_text()
    )
    boundary = current["claim_boundary"]
    need(boundary["ar02_complete"] is False, "AR-02 completion overstated")
    need(boundary["ar03_started"] is False, "AR-03 start overstated")
    need(boundary["production_mutated"] is False, "production mutation overstated")
    need(boundary["full_product_connection"] == "NOT_PROVEN", "full product connection overstated")
    need(boundary["superiority"] == "NOT_CERTIFIED", "superiority overstated")

    bootstrap = json.loads(
        (ROOT / "docs/axiom_recovery/AR02_GITLAB_FREE_MIRROR_BOOTSTRAP.json").read_text()
    )
    need(bootstrap["connected_tool_boundary"]["gitlab_project_created"] is False, "GitLab creation overstated")
    need(bootstrap["claim_boundary"]["gitlab_project_exists"] == "NOT_PROVEN", "GitLab existence overstated")
    need(bootstrap["claim_boundary"]["gitlab_ci_executed"] is False, "GitLab execution overstated")


def verify_ci_contract() -> None:
    text = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
    pinned = "python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254"
    need(text.count(pinned) >= 1, "immutable Python image digest missing")
    need('GIT_DEPTH: "0"' in text, "full history fetch not configured")
    need("ar02-builder:" in text and "ar02-independent-verifier:" in text, "required jobs missing")
    need("needs:" in text, "independent verifier dependency missing")
    need("CI_PIPELINE_SOURCE == \"merge_request_event\"" in text, "merge-request pipeline rule missing")
    need("CI_COMMIT_REF_PROTECTED == \"true\"" in text, "protected-ref pipeline rule missing")
    need("when: never" in text, "default-deny pipeline rule missing")
    for forbidden in (
        "wrangler deploy",
        "api.cloudflare.com",
        "CLOUDFLARE_GLOBAL_API_KEY",
        "environment:",
        "artifacts:",
        "cache:",
    ):
        need(forbidden not in text, f"forbidden CI capability present: {forbidden}")


def main() -> int:
    try:
        verify_authority_and_scope()
        verify_forensic_counts()
        verify_evidence_ledgers()
        verify_ci_contract()
        sh("git", "diff", "--check")
    except (RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"AR-02 GITLAB MIRROR INDEPENDENT VERIFIER: FAIL: {exc}", file=sys.stderr)
        return 1

    print("AR-02 GITLAB MIRROR INDEPENDENT VERIFIER: PASS")
    print("repository_global_key_files=164")
    print("workflow_global_key_files=158")
    print("artifact_crypto_reuse_files=51")
    print("artifact_hmac_reuse_files=29")
    print("workers_dev_exposure_or_activation_paths=19")
    print("provider_execution_performed=false")
    print("production_mutated=false")
    print("ar02_complete=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
