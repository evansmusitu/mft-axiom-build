#!/usr/bin/env python3
"""Builder-side verification for the AR-07--AR-09 candidate source package."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATUS_PATH = ROOT / "docs/axiom_recovery/AR07_AR09_CANDIDATE_STATUS_20260919.json"


def run(command):
    return subprocess.run(
        command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False
    )


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    compile_result = run([sys.executable, "-m", "compileall", "-q", "recovery/ar07_09"])
    require(compile_result.returncode == 0, compile_result.stdout)
    test_result = run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "recovery/ar07_09/tests",
            "-p",
            "test_*.py",
            "-v",
        ]
    )
    require(test_result.returncode == 0, test_result.stdout)
    require("Ran 6 tests" in test_result.stdout, "unexpected candidate test count")

    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    require(status["authority"]["production_authority"] is False, "authority drift")
    require(status["authority"]["s4_or_s5_authority"] is False, "risk authority drift")
    for phase in ("AR-07", "AR-08", "AR-09"):
        require(status["phases"][phase]["formal_gate"] == "NOT_EARNED", phase)
        require(status["claim_boundary"][phase.lower().replace("-", "") + "_earned"] is False, phase)
    require(status["claim_boundary"]["provider_or_production_mutated"] is False, "provider mutation overclaim")

    sys.path.insert(0, str(ROOT))
    from recovery.ar07_09.adversarial import ATTACK_DOMAINS, run_adversarial_qualification
    from recovery.ar07_09.application import SURFACES, UnifiedApplication
    from recovery.ar07_09.reliability import run_reliability_qualification

    require(len(SURFACES) == 10, "AR-07 surface count drift")
    require(len(ATTACK_DOMAINS) == 11, "AR-08 attack-domain count drift")
    require((ROOT / "recovery/ar07_09/web/index.html").is_file(), "application shell missing")
    require((ROOT / "recovery/ar07_09/web/app.css").is_file(), "application styles missing")
    require((ROOT / "recovery/ar07_09/web/app.js").is_file(), "application client missing")

    with tempfile.TemporaryDirectory(prefix="axiom-ar07-ar09-builder-") as td:
        root = Path(td)
        app = UnifiedApplication(root / "application.sqlite3", secret_key=b"builder-verification-key-only")
        owner = app.onboard("builder@example.test", "BuilderPassword!2026", "Builder Synthetic")
        result = app.compose(
            owner["session_token"], owner["project_id"], "20+22", request_id="builder-smoke"
        )
        detail = app.task_detail(owner["session_token"], owner["project_id"], result["task_id"])
        require(result["result"] == 42, "application smoke result mismatch")
        require(detail["integrity"]["status"] == "PASS", "application task evidence failed")
        require(app.manifest()["formal_gate_earned"] is False, "application self-certified")
        app.close()
        adversarial = run_adversarial_qualification(root / "adversarial", secret_key=b"builder-verification-key-only")
        reliability = run_reliability_qualification(
            root / "reliability", secret_key=b"builder-verification-key-only", sample_size=12
        )
        require(adversarial["status"] == "PASS", "controlled adversarial qualification failed")
        require(reliability["status"] == "PASS", "controlled reliability qualification failed")
        require(adversarial["phase_gate"] == "NOT_EARNED", "AR-08 self-certified")
        require(reliability["phase_gate"] == "NOT_EARNED", "AR-09 self-certified")

    print(
        json.dumps(
            {
                "schema": "musitu.axiom.recovery.ar07-ar09-builder-verdict.v1",
                "status": "PASS",
                "tests_passed": 6,
                "surface_count": 10,
                "attack_domain_count": 11,
                "reliability_sample_size": 12,
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
                    "schema": "musitu.axiom.recovery.ar07-ar09-builder-verdict.v1",
                    "status": "FAIL",
                    "error": f"{type(error).__name__}: {error}",
                },
                sort_keys=True,
            )
        )
        raise SystemExit(1)
