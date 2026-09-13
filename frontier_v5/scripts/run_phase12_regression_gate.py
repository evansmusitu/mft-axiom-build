#!/usr/bin/env python3
from __future__ import annotations
import os
import subprocess
import sys


def run(*args: str) -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, *args], env=env)


def main() -> None:
    run("frontier_v5/scripts/run_phase11_regression_gate.py")
    run("frontier_v5/tests/test_developer_platform.py")
    run("frontier_v5/scripts/run_phase12_security_gate.py")
    print("MUSITU_AXIOM_INTERFACE_PHASE12_RUNTIME_REGRESSION_PASS")


if __name__ == "__main__":
    main()
