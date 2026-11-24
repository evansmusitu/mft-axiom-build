#!/usr/bin/env python3
"""Fail-closed repository contract for Frontier v5 supply-chain controls.

This test uses only the standard library so it can execute before third-party
packages are installed. It verifies repository-owned reproducibility policy;
runtime package versions are separately verified by
``frontier_v5/scripts/verify_supply_chain.py`` in the full-stack CI job.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
LOCK = FRONTIER / "supply_chain" / "LOCK.json"
REQ = FRONTIER / "requirements" / "fullstack.lock.txt"
CI = ROOT / ".github/workflows/axiom-frontier-v5-ci.yml"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
# Matches both "uses:" under a named step and the "- uses:" list-item form.
USES = re.compile(r"^\s*(?:-\s+)?uses:\s*([^\s@#]+)@([^\s#]+)", re.M)
ANY_USES = re.compile(r"^\s*(?:-\s+)?uses:", re.M)
RUNS_ON = re.compile(r"^\s*runs-on:\s*(\S+)", re.M)
PYTHON_VERSION = re.compile(r"python-version:\s*['\"]?([^'\"\s]+)")
PINNED_REQ = re.compile(r"^[A-Za-z0-9_.-]+==[^=\s]+$")


def fail(message: str) -> None:
    raise AssertionError(message)


def job_block(text: str, job: str) -> str:
    match = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text, re.M | re.S)
    if not match:
        fail(f"CI workflow job missing: {job}")
    return match.group(1)


def main() -> None:
    if not LOCK.is_file():
        fail("frontier_v5/supply_chain/LOCK.json is required")
    if not REQ.is_file():
        fail("frontier_v5/requirements/fullstack.lock.txt is required")

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    assert lock.get("schema") == "musitu.axiom.frontier.supply-chain-lock.v1"
    runner = lock.get("runner") or {}
    assert runner.get("label") == "ubuntu-24.04"
    expected_python = str(runner.get("python") or "")
    assert re.fullmatch(r"3\.12\.\d+", expected_python), "Python must be patch-pinned"

    action_pins = lock.get("github_actions") or {}
    assert action_pins, "LOCK.json must pin the GitHub Actions used by Frontier workflows"
    for action, sha in action_pins.items():
        assert HEX40.fullmatch(str(sha)), f"{action} must be pinned to an immutable 40-hex commit"

    required: list[str] = []
    for line in REQ.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not PINNED_REQ.fullmatch(stripped):
            fail(f"unversioned or malformed Python dependency: {stripped}")
        required.append(stripped)
    assert required, "full-stack dependency lock cannot be empty"
    assert required == sorted(required, key=str.casefold), "dependency lock must be deterministically sorted"

    workflows = sorted((ROOT / ".github/workflows").glob("axiom-frontier-v5-*.yml"))
    if CI not in workflows:
        fail(f"required Frontier workflow missing: {CI.name}")
    used_actions: set[str] = set()
    for path in workflows:
        text = path.read_text(encoding="utf-8")
        runners = RUNS_ON.findall(text)
        if not runners:
            fail(f"{path.name} declares no runner")
        for label in runners:
            if label != "ubuntu-24.04":
                fail(f"{path.name} uses runner {label}; every job must pin ubuntu-24.04")
        refs = USES.findall(text)
        if len(refs) != len(ANY_USES.findall(text)):
            fail(f"{path.name} has a uses: reference this contract cannot parse")
        for action, ref in refs:
            if not HEX40.fullmatch(ref):
                fail(f"{path.name} action {action} uses mutable ref {ref}")
            if action_pins.get(action) != ref:
                fail(f"{path.name} action {action}@{ref} is not the commit recorded in LOCK.json")
            used_actions.add(action)
        for version in PYTHON_VERSION.findall(text):
            if version != expected_python:
                fail(f"{path.name} Python {version} differs from lock {expected_python}")
    unused = sorted(set(action_pins) - used_actions)
    if unused:
        fail(f"LOCK.json pins actions no Frontier workflow uses: {unused}")

    ci = CI.read_text(encoding="utf-8")
    for fragment in ("frontier_v5/**", ".github/workflows/axiom-frontier-v5-ci.yml"):
        if ci.count(f"'{fragment}'") < 2:
            fail(f"CI workflow must re-run on pull requests and main pushes that change {fragment}")

    full = job_block(ci, "fullstack-local")
    for fragment in ("pip install --upgrade pip", "pip install pillow", "pip install -U"):
        if fragment in full:
            fail(f"full-stack job contains a mutable dependency install: {fragment}")
    if "-r frontier_v5/requirements/fullstack.lock.txt" not in full:
        fail("full-stack job must install the checked-in dependency lock")
    if "verify_supply_chain.py" not in full:
        fail("full-stack job must execute the runtime supply-chain verifier")

    assets = lock.get("external_assets") or []
    for asset in assets:
        sha = str(asset.get("sha256") or "")
        assert re.fullmatch(r"[0-9a-f]{64}", sha), f"external asset {asset.get('id')} SHA-256 must be pinned"
        assert isinstance(asset.get("required"), bool), f"external asset {asset.get('id')} must declare required"
        if asset["required"] and (sha not in full or "sha256sum -c" not in full):
            fail(f"full-stack job must verify required asset {asset.get('id')} with sha256sum -c before use")

    playwright = lock.get("playwright") or {}
    required_names = {line.split("==", 1)[0].casefold(): line for line in required}
    expected_playwright = "playwright==" + str(playwright.get("python_package_version") or "")
    if required_names.get("playwright") != expected_playwright:
        fail("Playwright package version differs from supply-chain lock")
    assert str(playwright.get("chromium_build") or "").isdigit()

    capture = job_block(ci, "python-hash-capture")
    if "capture_distribution_hashes.py" not in capture:
        fail("hash-capture job must execute the reviewed capture utility")
    if "github.event_name == 'workflow_dispatch'" not in capture:
        fail("hash-capture job must only run on manual dispatch")
    if "capture_is_attestation" in capture:
        fail("hash-capture job must not self-promote captured hashes to attestation")

    status = lock.get("status") or {}
    assert status.get("versions_pinned") is True
    assert status.get("github_actions_commit_pinned") is True
    assert status.get("external_asset_digest_pinned") is True
    assert status.get("python_distribution_hashes_complete") is False
    assert status.get("os_package_snapshot_pinned") is False
    assert status.get("supply_chain_level") == "PARTIAL"

    print("MUSITU_AXIOM_FRONTIER_SUPPLY_CHAIN_CONTRACT_PASS")


if __name__ == "__main__":
    main()
