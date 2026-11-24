#!/usr/bin/env python3
"""Isolation contract: frontier_v5 and its CI cannot reach production.

The package is developed separately from the sealed production surfaces
(auth/, mcp/, ops/, submission/). This contract fails if Frontier CI gains
secrets or write permissions, or if package code gains a path to production
credentials, production hosts, Worker deployment, or the production database.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
WORKFLOWS = sorted((ROOT / ".github/workflows").glob("axiom-frontier-v5-*.yml"))
CODE = sorted(p for d in ("runtime", "scripts") for p in (FRONTIER / d).rglob("*.py"))

SEALED_DB = "504029cc-f9a5-495e-818f-63c6144b4ea4"
D1_ADAPTER = FRONTIER / "runtime" / "fullstack_base.py"

# Markers that must never appear in package code, with the only file allowed to carry each.
FORBIDDEN_IN_CODE: dict[str, set[Path]] = {
    "X-Auth-Key": set(),  # Cloudflare Global API Key header
    "X-Auth-Email": set(),
    "CLOUDFLARE_GLOBAL_API_KEY": set(),
    "/workers/scripts": set(),  # Worker deployment API
    "mftintelligence.com": set(),  # production hosts
    SEALED_DB: {D1_ADAPTER},  # only the adapter's refusal constant
    "api.cloudflare.com": {D1_ADAPTER},  # only the token-only, non-production D1 adapter
}


def fail(message: str) -> None:
    raise AssertionError(message)


def check_workflow(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    name = path.name
    if re.search(r"\$\{\{\s*secrets\.", text):
        fail(f"{name} references repository secrets")
    for trigger in ("pull_request_target", "workflow_run"):
        if re.search(rf"^\s*{trigger}\s*:", text, re.M):
            fail(f"{name} uses privileged trigger {trigger}")
    top = re.search(r"^permissions:\n((?:[ \t]+.*\n)+)", text, re.M)
    if not top or [line.strip() for line in top.group(1).splitlines() if line.strip()] != ["contents: read"]:
        fail(f"{name} must declare top-level permissions of exactly 'contents: read'")
    if re.search(r":\s*write\b", text):
        fail(f"{name} grants a write permission")
    if re.search(r"^\s*id-token\s*:", text, re.M):
        fail(f"{name} requests an OIDC token")
    for line in re.findall(r"^\s*persist-credentials\s*:\s*(\S+)", text, re.M):
        if line != "false":
            fail(f"{name} persists checkout credentials")
    checkouts = len(re.findall(r"uses:\s*actions/checkout@", text))
    if checkouts != len(re.findall(r"persist-credentials:\s*false", text)):
        fail(f"{name} has a checkout step that keeps the token in the workspace")


def check_code(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    for marker, allowed in FORBIDDEN_IN_CODE.items():
        if marker in text and path not in allowed:
            fail(f"{rel} contains production marker {marker!r}")


def main() -> None:
    if not WORKFLOWS:
        fail("no Frontier workflows found")
    for path in WORKFLOWS:
        check_workflow(path)
    assert CODE, "no Frontier package code found"
    for path in CODE:
        check_code(path)

    # The one adapter that can talk to Cloudflare must refuse the production database
    # and accept only a scoped API token (no Global API Key path).
    adapter = D1_ADAPTER.read_text(encoding="utf-8")
    assert f'SEALED_AXIOM_DB = "{SEALED_DB}"' in adapter
    for removed in ("frontier_live_verify", "frontier_independent_validate", "run_longitudinal_gate"):
        if (FRONTIER / "scripts" / f"{removed}.py").exists():
            fail(f"production/self-certifying script must stay removed: {removed}.py")

    # Self-check: the scanner must reject a planted violation.
    planted = FRONTIER / "runtime" / "fullstack_base.py"
    original = FORBIDDEN_IN_CODE["api.cloudflare.com"]
    FORBIDDEN_IN_CODE["api.cloudflare.com"] = set()
    try:
        check_code(planted)
    except AssertionError:
        pass
    else:
        raise AssertionError("isolation scanner failed to detect a production marker")
    finally:
        FORBIDDEN_IN_CODE["api.cloudflare.com"] = original

    print("MUSITU_AXIOM_FRONTIER_ISOLATION_BOUNDARY_PASS")


if __name__ == "__main__":
    main()
