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
    run("frontier_v5/scripts/run_phase13_regression_gate.py")
    run("frontier_v5/tests/test_pwa_resilience.py")
    run("axiom_interface/tests/test_pwa_phase14.py")
    run("frontier_v5/scripts/run_phase14_security_gate.py")
    print("MUSITU_AXIOM_INTERFACE_PHASE14_RUNTIME_CANDIDATE_PASS_REAL_DEVICE_REQUIRED")


if __name__ == "__main__":
    main()

