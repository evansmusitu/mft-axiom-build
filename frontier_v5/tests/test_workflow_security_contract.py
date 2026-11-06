#!/usr/bin/env python3
"""Frontier PR workflow trust-boundary regression: local static policy ONLY.

This test does not confer independent security approval, supply-chain
attestation, staging authorization, or production release permission.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".github/workflows/axiom-frontier-v5-skill-gate.yml"
FULL = ROOT / ".github/workflows/axiom-frontier-v5-fullstack-verification.yml"
PINNED = re.compile(r"^[0-9a-f]{40}$")


def verify(skill: str, full: str) -> None:
    for name, source in (("skill", skill), ("fullstack", full)):
        if not re.search(r"(?m)^on:\s*$", source):
            raise AssertionError(name + ": missing explicit workflow triggers")
        if not re.search(r"(?m)^  pull_request:\s*$", source):
            raise AssertionError(name + ": pull_request-only review trigger missing")
        if re.search(r"(?m)^  (?:push|pull_request_target|workflow_run):", source):
            raise AssertionError(name + ": privileged or automatic push trigger")
        if not re.search(r"(?m)^permissions:\s*\n  contents: read\s*$", source):
            raise AssertionError(name + ": contents-read-only permissions required")
        if re.search(r"(?m)^\s*(?:contents|actions|checks|deployments|id-token|issues|packages|pages|pull-requests|security-events|statuses):\s*write(?:\s|$)", source):
            raise AssertionError(name + ": write-capable token request prohibited")
        if "secrets." in source or "pull_request_target" in source:
            raise AssertionError(name + ": secret interpolation or privileged event prohibited")
        uses = re.findall(r"(?m)^\s*uses:\s*([^\s@]+)@([^\s#]+)", source)
        if not uses or any(not PINNED.fullmatch(revision) for _, revision in uses):
            raise AssertionError(name + ": action references must be full SHA pins")
        checkout_spans = list(re.finditer(r"(?m)^\s*uses:\s*actions/checkout@[0-9a-f]{40}\s*$", source))
        if not checkout_spans:
            raise AssertionError(name + ": pinned checkout required")
        for checkout in checkout_spans:
            next_lines = source[checkout.end():].splitlines()[:7]
            if not any(re.fullmatch(r"\s*persist-credentials:\s*false\s*", line) for line in next_lines):
                raise AssertionError(name + ": persisted checkout token not disabled")
        if name == "fullstack":
            marker = "      - name: Block legacy production-writing live adapter pending isolated staging security gate"
            if source.count(marker) != 1:
                raise AssertionError("fullstack: independent staging veto missing or duplicated")
            segment = source.split(marker, 1)[1].split("\n      - name:", 1)[0]
            if not re.search(r"(?m)^\s*exit 1\s*$", segment):
                raise AssertionError("fullstack: legacy adapter veto not fail-closed")
            if "MUSITU_AXIOM_FRONTIER_LIVE_ADAPTER_NOT_QUALIFIED" not in segment:
                raise AssertionError("fullstack: explicit non-qualification marker missing")
            if re.search(r"(?m)^\s*(?:PYTHONPATH=\S+\s+)?python(?:3)?\s+frontier_v5/scripts/frontier_live_verify(?:_v2)?\.py", source):
                raise AssertionError("fullstack: legacy production-writing script invoked")


def require_rejection(skill: str, full: str, label: str) -> None:
    try:
        verify(skill, full)
    except AssertionError:
        return
    raise AssertionError("negative regression failed open: " + label)


def main() -> None:
    skill = SKILL.read_text(encoding="utf-8")
    full = FULL.read_text(encoding="utf-8")
    verify(skill, full)
    require_rejection(skill.replace("persist-credentials: false", "persist-credentials: true", 1), full, "persisted skill token")
    require_rejection(skill, full.replace("persist-credentials: false", "persist-credentials: true", 1), "persisted browser token")
    require_rejection(skill, full.replace("permissions:\n  contents: read", "permissions:\n  contents: write", 1), "write token")
    require_rejection(skill.replace("  workflow_dispatch:", "  pull_request_target:\n  workflow_dispatch:", 1), full, "privileged trigger")
    require_rejection(skill, full.replace("          exit 1", "          echo bypass", 1), "missing staging veto")
    require_rejection(skill, full.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n# secrets.AXIOM_TEST", 1), "secret interpolation")
    print("MUSITU_AXIOM_FRONTIER_WORKFLOW_TRUST_BOUNDARY_PASS_LOCAL_STATIC_ONLY_NOT_RELEASE")


if __name__ == "__main__":
    main()
