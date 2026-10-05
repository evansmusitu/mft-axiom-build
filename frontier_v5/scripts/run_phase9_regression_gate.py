#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys


def run(*args: str) -> None:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = "."
    subprocess.check_call([sys.executable, *args], env=environment)


def main() -> None:
    # The earned Phase-8 runtime envelope is inherited intact.
    run("frontier_v5/scripts/run_phase8_regression_gate.py")
    run("frontier_v5/tests/test_agent_automation.py")
    run("frontier_v5/scripts/run_phase9_security_gate.py")
    print("MUSITU_AXIOM_INTERFACE_PHASE9_RUNTIME_REGRESSION_PASS")


if __name__ == "__main__":
    main()
