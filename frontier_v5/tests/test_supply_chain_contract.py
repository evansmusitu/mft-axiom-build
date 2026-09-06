#!/usr/bin/env python3
"""Fail-closed reproducibility contract for Frontier v5 CI.

This test is intentionally independent of PyYAML so it can run before any
third-party Python dependency is installed. It verifies only repository-owned
CI policy. Package/archive authenticity is enforced by the lock artifacts and
workflow commands that this contract requires.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
LOCK = FRONTIER / "evals" / "SUPPLY_CHAIN_LOCK.json"
REQ = FRONTIER / "requirements-fullstack.lock"
WORKFLOWS = {
    "fullstack": ROOT / ".github/workflows/axiom-frontier-v5-fullstack-verification.yml",
    "security": ROOT / ".github/workflows/axiom-frontier-v5-security-regression.yml",
    "comparative": ROOT / ".github/workflows/axiom-frontier-v5-external-comparative-gate.yml",
}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
ACTION = re.compile(r"^\s*uses:\s*(actions/(?:checkout|setup-python|upload-artifact))@([^\s#]+)", re.M)
PYTHON_VERSION = re.compile(r"python-version:\s*['\"]?([^'\"\s]+)")
PINNED_REQ = re.compile(r"^[A-Za-z0-9_.-]+==[^=\s]+$")


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    if not LOCK.is_file():
        fail("SUPPLY_CHAIN_LOCK.json is required")
    if not REQ.is_file():
        fail("requirements-fullstack.lock is required")

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    assert lock.get("schema") == "musitu.axiom.frontier.supply-chain-lock.v1"
    assert lock.get("runner") == "ubuntu-24.04"
    expected_python = str(lock.get("python") or "")
    assert re.fullmatch(r"3\.12\.\d+", expected_python), "Python must be patch-pinned"

    action_pins = lock.get("github_actions") or {}
    for action in ("actions/checkout", "actions/setup-python", "actions/upload-artifact"):
        value = str(action_pins.get(action) or "")
        assert HEX40.fullmatch(value), f"{action} must be pinned to an immutable 40-hex commit"

    required = []
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
        text = path.read_text(encoding="utf-8")
        if "runs-on: ubuntu-latest" in text:
            fail(f"{name} workflow uses mutable ubuntu-latest")
        if "runs-on: ubuntu-24.04" not in text:
            fail(f"{name} workflow must pin ubuntu-24.04")
        matches = ACTION.findall(text)
        for action, ref in matches:
            if not HEX40.fullmatch(ref):
                fail(f"{name} workflow action {action} uses mutable ref {ref}")
            expected = action_pins.get(action)
            if expected and ref != expected:
                fail(f"{name} workflow action {action} differs from SUPPLY_CHAIN_LOCK.json")
        version = PYTHON_VERSION.search(text)
        if version and version.group(1) != expected_python:
            fail(f"{name} workflow Python {version.group(1)} differs from lock {expected_python}")

    full = WORKFLOWS["fullstack"].read_text(encoding="utf-8")
    forbidden = [
        "python -m pip install --upgrade pip",
        "python -m pip install pillow python-docx",
    ]
    for fragment in forbidden:
        if fragment in full:
            fail(f"fullstack workflow contains mutable dependency install: {fragment}")
    if "-r frontier_v5/requirements-fullstack.lock" not in full:
        fail("fullstack workflow must install the checked-in dependency lock")

    model = lock.get("vosk_model") or {}
    model_sha = str(model.get("sha256") or "")
    assert re.fullmatch(r"[0-9a-f]{64}", model_sha), "Vosk model SHA-256 must be pinned"
    if model_sha not in full or "sha256sum -c" not in full:
        fail("fullstack workflow must verify the Vosk model archive SHA-256 before unzip")

    playwright = lock.get("playwright") or {}
    assert str(playwright.get("python_package")) in required
    browser_revision = str(playwright.get("chromium_revision") or "")
    assert browser_revision.startswith("v") and browser_revision[1:].isdigit()

    print("MUSITU_AXIOM_FRONTIER_SUPPLY_CHAIN_CONTRACT_PASS")


if __name__ == "__main__":
    main()
