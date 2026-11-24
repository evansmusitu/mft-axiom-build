"""Run every Frontier v5 contract test script and fail if any of them fails.

Each ``frontier_v5/tests/test_*.py`` file is a standalone script that prints a
``MUSITU_..._PASS`` marker as its last action. A test counts as passed only
when its process exits with status 0 *and* prints the marker declared in its
own source, so a script that exits early without running its assertions is
reported as a failure.

Usage:
    python frontier_v5/scripts/run_contract_tests.py [--exclude NAME ...] [--only NAME ...]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "frontier_v5" / "tests"
MARKER = re.compile(r"MUSITU_[A-Z0-9_]+_PASS")


def expected_marker(path: Path) -> str:
    markers = MARKER.findall(path.read_text(encoding="utf-8"))
    if not markers:
        raise SystemExit(f"{path.name}: no MUSITU_..._PASS marker declared in source")
    return markers[-1]


def run_one(path: Path, timeout: int) -> tuple[bool, str, float]:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env.pop("PYTHONOPTIMIZE", None)  # bare asserts must execute
    marker = expected_marker(path)
    started = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, str(path)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, f"timed out after {timeout}s", time.monotonic() - started
    elapsed = time.monotonic() - started
    out_lines = proc.stdout.splitlines()
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-12:]
        return False, f"exit {proc.returncode}\n" + "\n".join(tail), elapsed
    if marker not in out_lines:
        return False, f"exit 0 but marker {marker} was not printed", elapsed
    return True, marker, elapsed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--exclude", action="append", default=[], help="test file name to skip (repeatable)")
    ap.add_argument("--only", action="append", default=[], help="run only these test file names (repeatable)")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args(argv)
    if sys.flags.optimize:
        print("refusing to run with -O: the contract tests use bare assert statements", file=sys.stderr)
        return 2
    tests = sorted(TESTS.glob("test_*.py"))
    known = {p.name for p in tests}
    for name in args.exclude + args.only:
        if name not in known:
            print(f"unknown test file: {name}", file=sys.stderr)
            return 2
    if args.only:
        tests = [p for p in tests if p.name in set(args.only)]
    tests = [p for p in tests if p.name not in set(args.exclude)]
    if not tests:
        print("no tests selected", file=sys.stderr)
        return 2
    failures = []
    for path in tests:
        ok, detail, elapsed = run_one(path, args.timeout)
        status = "PASS" if ok else "FAIL"
        print(f"{status} {path.name} ({elapsed:.1f}s)", flush=True)
        if not ok:
            failures.append(path.name)
            print("    " + detail.replace("\n", "\n    "), flush=True)
    print(f"{len(tests) - len(failures)}/{len(tests)} contract test scripts passed")
    if failures:
        print("FAILED: " + ", ".join(failures))
        return 1
    print("MUSITU_AXIOM_FRONTIER_CONTRACT_SUITE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
