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
    run("frontier_v5/scripts/run_phase12_regression_gate.py")
    run("frontier_v5/tests/test_evidence_observatory.py")
    run("axiom_interface/tests/test_evidence_phase13.py")
    run("frontier_v5/scripts/run_phase13_security_gate.py")
    print("MUSITU_AXIOM_INTERFACE_PHASE13_RUNTIME_CANDIDATE_PASS_AWAITING_INDEPENDENT_REVIEW")


if __name__ == "__main__":
    main()

