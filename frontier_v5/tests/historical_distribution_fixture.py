"""Resolve hash-checked historical distribution sources for offline tests.

These files are inert source fixtures. They are not active repository workflows,
an installed marketplace, a current distribution profile or release authority.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "qualification/whole-system-20261029/pinned-frontier-distribution-fixtures"
SOURCE_COMMIT = "8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3"
SCOPE = "HISTORICAL_SOURCE_FIXTURES_NOT_ACTIVE_WORKFLOWS_OR_CURRENT_RELEASE_AUTHORITY"


def pinned_distribution_fixture(relative: str) -> Path:
    """Return an explicitly pinned archive member, never an active fallback."""
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != relative:
        raise AssertionError("historical fixture path must be canonical and relative")
    manifest = json.loads((ARCHIVE / "MANIFEST.json").read_text(encoding="utf-8"))
    if manifest.get("source_commit") != SOURCE_COMMIT or manifest.get("scope") != SCOPE:
        raise AssertionError("historical distribution fixture source/scope drifted")
    expected = manifest.get("files", {}).get(relative)
    target = ARCHIVE / path
    if not expected or not target.is_file() or target.is_symlink():
        raise AssertionError(f"pinned historical distribution fixture missing: {relative}")
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise AssertionError(f"pinned historical distribution fixture digest mismatch: {relative}")
    return target
