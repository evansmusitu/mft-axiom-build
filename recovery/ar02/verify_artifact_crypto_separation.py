#!/usr/bin/env python3
"""AR-02 fail-closed scanner for provider-credential reuse as artifact crypto material."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
from typing import Iterable

DECRYPT_RE = re.compile(r"-pass\s+env:CLOUDFLARE_GLOBAL_API_KEY\b", re.IGNORECASE)
HMAC_RE = re.compile(
    r"(?:hmac\.new\(.{0,800}?CLOUDFLARE_GLOBAL_API_KEY|"
    r"CLOUDFLARE_GLOBAL_API_KEY.{0,800}?hmac\.new\()",
    re.IGNORECASE | re.DOTALL,
)


def tracked_files(root: pathlib.Path) -> list[pathlib.Path]:
    try:
        raw = subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z"], stderr=subprocess.DEVNULL
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return sorted(p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts)
    return [root / p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


def scan(root: pathlib.Path) -> dict[str, dict[str, bool]]:
    findings: dict[str, dict[str, bool]] = {}
    for path in tracked_files(root):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        decrypt = bool(DECRYPT_RE.search(text))
        hmac_use = bool(HMAC_RE.search(text))
        if decrypt or hmac_use:
            rel = path.relative_to(root).as_posix()
            findings[rel] = {
                "uses_global_key_as_decrypt_passphrase": decrypt,
                "uses_global_key_as_hmac_key": hmac_use,
            }
    return dict(sorted(findings.items()))


def load_baseline(path: pathlib.Path) -> dict[str, dict[str, bool]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "musitu.axiom.recovery.ar02-runtime-artifact-crypto-reuse-inventory.v1":
        raise SystemExit("baseline inventory schema mismatch")
    rows = data.get("files")
    if not isinstance(rows, list):
        raise SystemExit("baseline inventory files missing")
    out: dict[str, dict[str, bool]] = {}
    for row in rows:
        p = row.get("path")
        if not isinstance(p, str) or not p:
            raise SystemExit("baseline inventory path invalid")
        out[p] = {
            "uses_global_key_as_decrypt_passphrase": row.get("uses_global_key_as_decrypt_passphrase") is True,
            "uses_global_key_as_hmac_key": row.get("uses_global_key_as_hmac_key") is True,
        }
    if len(out) != len(rows):
        raise SystemExit("baseline inventory contains duplicate paths")
    return dict(sorted(out.items()))


def verify_no_regression(
    current: dict[str, dict[str, bool]], baseline: dict[str, dict[str, bool]]
) -> list[str]:
    errors: list[str] = []
    for path, flags in current.items():
        old = baseline.get(path)
        if old is None:
            errors.append(f"new cross-purpose provider credential reuse: {path}")
            continue
        for field, value in flags.items():
            if value and not old.get(field, False):
                errors.append(f"new reuse mode {field} in baseline path: {path}")
    return errors


def verify_zero(current: dict[str, dict[str, bool]]) -> list[str]:
    return [f"cross-purpose provider credential reuse remains: {path}" for path in current]


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--inventory",
        default="docs/axiom_recovery/AR02_RUNTIME_ARTIFACT_CRYPTO_REUSE_INVENTORY.json",
    )
    parser.add_argument("--mode", choices=("no-regression", "zero"), default="no-regression")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    root = pathlib.Path(args.root).resolve()
    current = scan(root)
    if args.mode == "no-regression":
        baseline = load_baseline(root / args.inventory)
        errors = verify_no_regression(current, baseline)
    else:
        errors = verify_zero(current)

    result = {
        "schema": "musitu.axiom.recovery.ar02-artifact-crypto-separation-verifier.v1",
        "mode": args.mode,
        "status": "PASS" if not errors else "FAIL",
        "detected_file_count": len(current),
        "decrypt_passphrase_file_count": sum(
            v["uses_global_key_as_decrypt_passphrase"] for v in current.values()
        ),
        "hmac_key_file_count": sum(
            v["uses_global_key_as_hmac_key"] for v in current.values()
        ),
        "errors": errors,
        "provider_execution_performed": False,
        "production_mutated": False,
    }
    print(json.dumps(result, sort_keys=True) if args.json else json.dumps(result, indent=2, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
