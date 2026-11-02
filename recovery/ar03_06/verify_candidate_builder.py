#!/usr/bin/env python3
"""Builder-side verification for the AR-03--AR-06 candidate source package."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATUS_PATH = (
    ROOT / "docs/axiom_recovery/AR03_AR06_CANDIDATE_STATUS_20260919.json"
)


def run(command):
    return subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    compile_result = run(
        [sys.executable, "-m", "compileall", "-q", "recovery/ar03_06"]
    )
    require(compile_result.returncode == 0, compile_result.stdout)

    test_result = run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "recovery/ar03_06/tests",
            "-p",
            "test_*.py",
            "-v",
        ]
    )
    require(test_result.returncode == 0, test_result.stdout)
    require("Ran 16 tests" in test_result.stdout, "unexpected candidate test count")

    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    require(status["authority"]["production_authority"] is False, "authority drift")
    require(status["authority"]["s4_or_s5_authority"] is False, "risk authority drift")
    for phase in ("AR-03", "AR-04", "AR-05", "AR-06"):
        require(status["phases"][phase]["formal_gate"] == "NOT_EARNED", phase)
        require(status["claim_boundary"][phase.lower().replace("-", "") + "_earned"] is False, phase)
    require(
        status["claim_boundary"]["provider_or_production_mutated"] is False,
        "provider mutation overclaim",
    )

    sys.path.insert(0, str(ROOT))
    from recovery.ar03_06.fabric import ATOMIC_OPERATIONS, LANE_ORDER
    from recovery.ar03_06.runtime import CandidateRuntime

    require(len(ATOMIC_OPERATIONS) == 74, "atomic registry count drift")
    require(len(set(ATOMIC_OPERATIONS)) == 74, "duplicate atomic operation")
    require([order for _, order in LANE_ORDER] == list(range(1, 11)), "lane order drift")

    with tempfile.TemporaryDirectory(prefix="axiom-builder-") as td:
        runtime = CandidateRuntime(
            Path(td) / "candidate.sqlite3",
            secret_key=b"builder-verification-key-only",
        )
        owner = runtime.onboard(
            "builder@example.test", "BuilderPassword!2026", "Builder Synthetic"
        )
        result = runtime.submit_arithmetic(
            owner["session_token"],
            owner["project_id"],
            "20+22",
            idempotency_key="builder-smoke",
        )
        require(result["state"] == "SUCCEEDED", "builder smoke task failed")
        require(result["result"] == 42, "builder smoke result mismatch")
        require(result["formal_gate_earned"] is False, "candidate self-certified")
        context = runtime.identity.authenticate(owner["session_token"])
        require(
            runtime.kernel.verify_task(context, result["task_id"])["status"] == "PASS",
            "task evidence failed",
        )
        require(
            runtime.graph.verify_project(context, owner["project_id"])["status"]
            == "PASS",
            "project evidence failed",
        )
        runtime.close()

    print(
        json.dumps(
            {
                "schema": "musitu.axiom.recovery.ar03-ar06-builder-verdict.v1",
                "status": "PASS",
                "tests_passed": 16,
                "compile": "PASS",
                "integrated_smoke": "PASS",
                "formal_gates_earned": False,
                "provider_execution_performed": False,
                "production_mutated": False,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {
                    "schema": "musitu.axiom.recovery.ar03-ar06-builder-verdict.v1",
                    "status": "FAIL",
                    "error": f"{type(error).__name__}: {error}",
                },
                sort_keys=True,
            )
        )
        raise SystemExit(1)

