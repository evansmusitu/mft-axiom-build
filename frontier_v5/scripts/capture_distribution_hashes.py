#!/usr/bin/env python3
"""Capture exact Python distribution artifacts for the Frontier full-stack lock.

This is a capture utility, not an attestation. It downloads each already pinned
requirement independently with ``--no-deps``, records the single distribution
artifact selected for the current CPython/runner contract, and emits a
commit-ready ``--require-hashes`` requirements file plus a JSON manifest.

The resulting hashes become security controls only after review, check-in and a
later clean CI run that installs with ``pip --require-hashes``. A hash generated
and consumed in the same run is not treated as prior trust.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

PIN = re.compile(r"^[A-Za-z0-9_.-]+==[^\s=]+$")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def pins(path: Path) -> list[str]:
    out: list[str] = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if not PIN.fullmatch(line):
            raise SystemExit(f"invalid exact requirement at {path}:{lineno}: {line!r}")
        out.append(line)
    if not out:
        raise SystemExit("requirements lock is empty")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requirements", type=Path, required=True)
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--hashed-requirements", type=Path, required=True)
    args = parser.parse_args()

    if args.workdir.exists():
        shutil.rmtree(args.workdir)
    args.workdir.mkdir(parents=True)
    records = []

    for index, requirement in enumerate(pins(args.requirements), 1):
        target = args.workdir / f"{index:03d}"
        target.mkdir()
        cmd = [
            sys.executable,
            "-m",
            "pip",
            "download",
            "--disable-pip-version-check",
            "--no-deps",
            "--dest",
            str(target),
            requirement,
        ]
        completed = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if completed.returncode != 0:
            raise SystemExit(f"pip download failed for {requirement}:\n{completed.stdout}")
        files = sorted(p for p in target.iterdir() if p.is_file())
        if len(files) != 1:
            raise SystemExit(
                f"expected exactly one selected distribution for {requirement}, got {[p.name for p in files]}"
            )
        artifact = files[0]
        digest = sha256_file(artifact)
        record = {
            "requirement": requirement,
            "filename": artifact.name,
            "sha256": digest,
            "size": artifact.stat().st_size,
        }
        records.append(record)
        print(f"REQHASH|{requirement}|{artifact.name}|{digest}|{artifact.stat().st_size}")

    manifest = {
        "schema": "musitu.axiom.frontier.python-distribution-hash-capture.v1",
        "python": ".".join(str(x) for x in sys.version_info[:3]),
        "capture_is_attestation": False,
        "record_count": len(records),
        "records": records,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    hashed_lines = [
        "# MUSITU Axiom Frontier v5 Python distribution hash lock.",
        "# Generated from exact version pins; security authority begins only after review/check-in.",
        "# Platform contract: ubuntu-24.04 / CPython 3.12.14.",
        "",
    ]
    hashed_lines.extend(f"{r['requirement']} --hash=sha256:{r['sha256']}" for r in records)
    args.hashed_requirements.parent.mkdir(parents=True, exist_ok=True)
    args.hashed_requirements.write_text("\n".join(hashed_lines) + "\n", encoding="utf-8")

    print("MUSITU_AXIOM_FRONTIER_PYTHON_DISTRIBUTION_HASH_CAPTURE_PASS")
    print("---BEGIN_HASHED_REQUIREMENTS---")
    print(args.hashed_requirements.read_text(encoding="utf-8"), end="")
    print("---END_HASHED_REQUIREMENTS---")


if __name__ == "__main__":
    main()
