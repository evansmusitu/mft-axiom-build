#!/usr/bin/env python3
"""Fail-closed repository contract for Frontier v5 supply-chain controls.

This test uses only the standard library so it can execute before third-party
packages are installed. It verifies repository-owned reproducibility policy;
runtime package versions and downloaded-asset bytes are separately verified by
``frontier_v5/scripts/verify_supply_chain.py`` in the Full-Stack gate.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
LOCK = FRONTIER / "supply_chain" / "LOCK.json"
REQ = FRONTIER / "requirements" / "fullstack.lock.txt"
WORKFLOWS = {
    "fullstack": ROOT / ".github/workflows/axiom-frontier-v5-fullstack-verification.yml",
    "security": ROOT / ".github/workflows/axiom-frontier-v5-security-regression.yml",
    "comparative": ROOT / ".github/workflows/axiom-frontier-v5-external-comparative-gate.yml",
    "skill": ROOT / ".github/workflows/axiom-frontier-v5-skill-gate.yml",
    "objective": ROOT / ".github/workflows/axiom-frontier-v5-objective-gate.yml",
    "supply_chain": ROOT / ".github/workflows/axiom-frontier-v5-supply-chain-gate.yml",
    "python_hash_capture": ROOT / ".github/workflows/axiom-frontier-v5-python-hash-capture.yml",
    "durable_tasks": ROOT / ".github/workflows/axiom-frontier-v5-durable-task-gate.yml",
    "mcp_2026": ROOT / ".github/workflows/axiom-frontier-v5-mcp-2026-gate.yml",
    "cimd": ROOT / ".github/workflows/axiom-frontier-v5-cimd-gate.yml",
    "oidc": ROOT / ".github/workflows/axiom-frontier-v5-oidc-gate.yml",
    "enterprise_identity": ROOT / ".github/workflows/axiom-frontier-v5-enterprise-identity-gate.yml",
    "data_lifecycle": ROOT / ".github/workflows/axiom-frontier-v5-data-lifecycle-gate.yml",
    "enterprise_spend": ROOT / ".github/workflows/axiom-frontier-v5-enterprise-spend-gate.yml",
    "enterprise_slo": ROOT / ".github/workflows/axiom-frontier-v5-enterprise-slo-gate.yml",
    "enterprise_incident_response": ROOT / ".github/workflows/axiom-frontier-v5-enterprise-incident-response-gate.yml",
}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
ACTION = re.compile(r"^\s*uses:\s*(actions/(?:checkout|setup-python|upload-artifact))@([^\s#]+)", re.M)
PYTHON_VERSION = re.compile(r"python-version:\s*['\"]?([^'\"\s]+)")
PINNED_REQ = re.compile(r"^[A-Za-z0-9_.-]+==[^=\s]+$")


def fail(message: str) -> None:
    raise AssertionError(message)


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
    for action in ("actions/checkout", "actions/setup-python", "actions/upload-artifact"):
        value = str(action_pins.get(action) or "")
        assert HEX40.fullmatch(value), f"{action} must be pinned to an immutable 40-hex commit"

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

    for name, path in WORKFLOWS.items():
        if not path.is_file():
            fail(f"required Frontier workflow missing: {path.name}")
        text = path.read_text(encoding="utf-8")
        if "runs-on: ubuntu-latest" in text:
            fail(f"{name} workflow uses mutable ubuntu-latest")
        if "runs-on: ubuntu-24.04" not in text:
            fail(f"{name} workflow must pin ubuntu-24.04")
        for action, ref in ACTION.findall(text):
            if not HEX40.fullmatch(ref):
                fail(f"{name} workflow action {action} uses mutable ref {ref}")
            expected = action_pins.get(action)
            if expected and ref != expected:
                fail(f"{name} workflow action {action} differs from LOCK.json")
        version = PYTHON_VERSION.search(text)
        if version and version.group(1) != expected_python:
            fail(f"{name} workflow Python {version.group(1)} differs from lock {expected_python}")

    full = WORKFLOWS["fullstack"].read_text(encoding="utf-8")
    for fragment in ("python -m pip install --upgrade pip", "python -m pip install pillow python-docx"):
        if fragment in full:
            fail(f"fullstack workflow contains mutable dependency install: {fragment}")
    if "-r frontier_v5/requirements/fullstack.lock.txt" not in full:
        fail("fullstack workflow must install the checked-in dependency lock")
    if "verify_supply_chain.py" not in full:
        fail("fullstack workflow must execute the runtime supply-chain verifier")

    assets = lock.get("external_assets") or []
    assert len(assets) == 1, "current contract expects exactly one external runtime asset"
    model = assets[0]
    model_sha = str(model.get("sha256") or "")
    assert re.fullmatch(r"[0-9a-f]{64}", model_sha), "Vosk model SHA-256 must be pinned"
    if model_sha not in full or "sha256sum -c" not in full:
        fail("fullstack workflow must verify the Vosk model archive SHA-256 before unzip")

    playwright = lock.get("playwright") or {}
    required_names = {line.split("==", 1)[0].casefold(): line for line in required}
    expected_playwright = "playwright==" + str(playwright.get("python_package_version") or "")
    if required_names.get("playwright") != expected_playwright:
        fail("Playwright package version differs from supply-chain lock")
    assert str(playwright.get("chromium_build") or "").isdigit()

    capture = WORKFLOWS["python_hash_capture"].read_text(encoding="utf-8")
    if "capture_distribution_hashes.py" not in capture:
        fail("Python hash-capture workflow must execute the reviewed capture utility")
    if "capture_is_attestation" in capture:
        fail("Python hash-capture workflow must not self-promote captured hashes to attestation")

    # The supply-chain workflow must trigger when any separately governed
    # Frontier workflow changes; otherwise a workflow could drift without this
    # contract being re-evaluated.
    supply_text = WORKFLOWS["supply_chain"].read_text(encoding="utf-8")
    for name, path in WORKFLOWS.items():
        if name == "supply_chain":
            continue
        relative = path.relative_to(ROOT).as_posix()
        if relative not in supply_text:
            fail(f"supply-chain gate does not trigger on governed workflow: {relative}")

    status = lock.get("status") or {}
    assert status.get("versions_pinned") is True
    assert status.get("github_actions_commit_pinned") is True
    assert status.get("external_asset_digest_pinned") is True
    # Preserve the claim boundary until stronger work is actually completed.
    assert status.get("python_distribution_hashes_complete") is False
    assert status.get("os_package_snapshot_pinned") is False
    assert status.get("supply_chain_level") == "PARTIAL"

    print("MUSITU_AXIOM_FRONTIER_SUPPLY_CHAIN_CONTRACT_PASS")


if __name__ == "__main__":
    main()
