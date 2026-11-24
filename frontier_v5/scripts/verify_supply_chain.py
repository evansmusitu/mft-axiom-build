#!/usr/bin/env python3
"""Fail-closed Frontier v5 supply-chain lock verifier.

This gate verifies the parts MUSITU can currently make deterministic without
claiming more than the evidence supports:
- exact CPython version;
- every locked Python distribution installed at the exact recorded version;
- dependency consistency via ``pip check``;
- immutable commit-SHA references for all Frontier-v5 GitHub Actions;
- digest of any downloaded external asset supplied to the verifier;
- deterministic JSON SBOM/evidence output.

The checked-in LOCK.json intentionally remains PARTIAL while Python wheel/sdist
hashes and an immutable OS package snapshot are not yet complete.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import re
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "frontier_v5/supply_chain/LOCK.json"
ACTION_SHA = re.compile(r"^[0-9a-f]{40}$")
USES = re.compile(r"^\s*uses:\s*([^\s@]+)@([^\s#]+)", re.MULTILINE)
PIN = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s]+)$")


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def read_python_lock(path: pathlib.Path) -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = PIN.fullmatch(line)
        if not match:
            raise SystemExit(f"invalid exact pin at {path}:{lineno}: {line!r}")
        display, version = match.groups()
        key = normalize(display)
        if key in out:
            raise SystemExit(f"duplicate Python distribution pin: {display}")
        out[key] = (display, version)
    if not out:
        raise SystemExit("Python lock is empty")
    return out


def verify_actions(lock: dict[str, Any]) -> list[dict[str, str]]:
    expected = dict(lock["github_actions"])
    rows: list[dict[str, str]] = []
    workflows = sorted((ROOT / ".github/workflows").glob("axiom-frontier-v5-*.yml"))
    if not workflows:
        raise SystemExit("no Frontier v5 workflows found")
    for workflow in workflows:
        text = workflow.read_text(encoding="utf-8")
        for action, ref in USES.findall(text):
            if not ACTION_SHA.fullmatch(ref):
                raise SystemExit(f"mutable GitHub Action reference prohibited: {workflow.name}: {action}@{ref}")
            recorded = expected.get(action)
            if recorded is not None and ref != recorded:
                raise SystemExit(f"GitHub Action SHA differs from LOCK.json: {action}@{ref}")
            rows.append({"workflow": workflow.name, "action": action, "sha": ref})
    if not rows:
        raise SystemExit("Frontier workflows contain no verifiable action references")
    return rows


def verify_python(lock: dict[str, Any]) -> list[dict[str, str]]:
    expected_python = str(lock["runner"]["python"])
    actual_python = ".".join(str(x) for x in sys.version_info[:3])
    if actual_python != expected_python:
        raise SystemExit(f"Python version mismatch: expected {expected_python}, got {actual_python}")

    pins = read_python_lock(ROOT / lock["python_lock"])
    installed: list[dict[str, str]] = []
    for key, (display, expected) in sorted(pins.items()):
        try:
            actual = importlib.metadata.version(display)
        except importlib.metadata.PackageNotFoundError as exc:
            raise SystemExit(f"locked Python distribution is missing: {display}") from exc
        if actual != expected:
            raise SystemExit(f"Python distribution drift: {display} expected {expected}, got {actual}")
        installed.append({"name": display, "normalized_name": key, "version": actual})

    check = subprocess.run([sys.executable, "-m", "pip", "check"], text=True, capture_output=True)
    if check.returncode != 0:
        raise SystemExit("pip dependency consistency failed: " + (check.stdout + check.stderr).strip())
    return installed


def verify_asset(lock: dict[str, Any], asset_path: pathlib.Path | None) -> dict[str, str] | None:
    if asset_path is None:
        return None
    assets = list(lock.get("external_assets") or [])
    if len(assets) != 1:
        raise SystemExit("--asset currently requires exactly one declared external asset")
    asset = assets[0]
    if not asset_path.is_file():
        raise SystemExit(f"external asset missing: {asset_path}")
    actual = sha256_file(asset_path)
    expected = str(asset["sha256"])
    if actual != expected:
        raise SystemExit(f"external asset digest mismatch: expected {expected}, got {actual}")
    return {"id": str(asset["id"]), "path": str(asset_path), "sha256": actual}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("/tmp/musitu-frontier-supply-chain.json"))
    args = parser.parse_args()

    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    if lock.get("schema") != "musitu.axiom.frontier.supply-chain-lock.v1":
        raise SystemExit("unexpected supply-chain lock schema")
    actions = verify_actions(lock)
    packages = verify_python(lock)
    asset = verify_asset(lock, args.asset)

    lock_sha = sha256_file(LOCK_PATH)
    python_lock_sha = sha256_file(ROOT / lock["python_lock"])
    evidence = {
        "schema": "musitu.axiom.frontier.supply-chain-evidence.v1",
        "status": "PASS",
        "attestation_scope": "PARTIAL_REPRODUCIBILITY_NOT_COMPLETE_SUPPLY_CHAIN_ATTESTATION",
        "python": str(lock["runner"]["python"]),
        "packages": packages,
        "github_actions": actions,
        "external_asset": asset,
        "lock_sha256": lock_sha,
        "python_lock_sha256": python_lock_sha,
        "known_unclosed": {
            "python_distribution_hashes_complete": bool(lock["status"]["python_distribution_hashes_complete"]),
            "os_package_snapshot_pinned": bool(lock["status"]["os_package_snapshot_pinned"]),
        },
    }
    evidence["sbom_sha256"] = hashlib.sha256(canonical(packages)).hexdigest()
    evidence["evidence_sha256"] = hashlib.sha256(canonical(evidence)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": evidence["status"],
        "attestation_scope": evidence["attestation_scope"],
        "package_count": len(packages),
        "action_reference_count": len(actions),
        "asset_verified": asset is not None,
        "evidence_sha256": evidence["evidence_sha256"],
    }, indent=2))
    print("MUSITU_AXIOM_FRONTIER_SUPPLY_CHAIN_LOCK_PASS")


if __name__ == "__main__":
    main()
