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
    run("frontier_v5/scripts/verify_phase12_authority.py")
    run("frontier_v5/scripts/run_phase14_regression_gate.py")
    run("axiom_interface/tests/test_browser_application.py")
    print("MUSITU_AXIOM_BROWSER_APPLICATION_RUNTIME_REGRESSION_PASS")


if __name__ == "__main__":
    main()
