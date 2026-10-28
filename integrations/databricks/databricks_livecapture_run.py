"""One-time bounded Databricks run for 30 real-service Axiom financial snapshots.

Compares captured outputs against independent financial oracles inside Databricks.
Does NOT call Axiom MCP from Databricks or access external/customer data.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from databricks_import import PILOT_FOLDER, validate_username
from databricks_scale_run import make_api

TARGET = "04_musitu_axiom_livecapture_30"
IDEMPOTENCY = "musitu-axiom-databricks-livecapture-30-20261028-v1"
EXPECTED = {"finance.npv": 10, "finance.black_scholes": 10, "finance.var_historical": 10}


def build_job(path: str) -> dict:
    if not re.fullmatch(
        r"/Users/[A-Za-z0-9._%+@-]+/MUSITU_AXIOM_PRIVATE_PILOT_20261027/04_musitu_axiom_livecapture_30",
        path,
    ):
        raise ValueError("Refusing non-pilot Databricks notebook path")
    return {
        "run_name": "MUSITU_AXIOM_LIVE_CAPTURE_30_PARITY_20261028",
        "idempotency_token": IDEMPOTENCY,
        "timeout_seconds": 900,
        "tasks": [{
            "task_key": "axiom_livecapture_30_oracles",
            "notebook_task": {"notebook_path": path, "source": "WORKSPACE"},
            "timeout_seconds": 750,
            "max_retries": 0,
        }],
    }


def verify_result(value: str) -> dict:
    try:
        evidence = json.loads(value)
    except (TypeError, ValueError):
        raise RuntimeError("Malformed Databricks 30-case evidence") from None
    if not isinstance(evidence, dict):
        raise RuntimeError("Databricks evidence not an object")
    for key, expected in {
        "total": 30, "passed": 30, "failed": 0,
        "invalid_option_parameter_rejected": True,
        "spark_aggregation": "VERIFIED",
        "live_axiom_called_from_databricks": False,
        "source_axiom_verified_field": "null",
    }.items():
        if evidence.get(key) != expected:
            raise RuntimeError("Databricks financial parity mismatch at " + key)
    if evidence.get("operations") != EXPECTED:
        raise RuntimeError("Unexpected Axiom operation counts")
    if not isinstance(evidence.get("max_abs_error"), (float, int)) or evidence["max_abs_error"] > 1e-8:
        raise RuntimeError("Financial accuracy outside tolerance")
    if not re.fullmatch(r"[0-9a-f]{64}", evidence.get("fixture_result_sha256", "")):
        raise RuntimeError("Missing digest for 30-case evidence")
    return evidence


def execute(api, sleep=time.sleep, *, max_polls=60):
    identity = api("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(identity.get("userName") if isinstance(identity, dict) else None)
    path = f"/Users/{username}/{PILOT_FOLDER}/{TARGET}"
    status = api("GET", "/api/2.0/workspace/get-status", params={"path": path})
    if not isinstance(status, dict) or status.get("object_type") != "NOTEBOOK" or status.get("language") != "PYTHON":
        raise RuntimeError("30-case notebook not available in Databricks workspace")
    response = api("POST", "/api/2.2/jobs/runs/submit", payload=build_job(path))
    run_id = response.get("run_id") if isinstance(response, dict) else None
    if not isinstance(run_id, int):
        raise RuntimeError("No Databricks job run id")
    print("MUSITU_AXIOM_LIVECAPTURE_DATABRICKS_RUN_ID=" + str(run_id), flush=True)
    for poll in range(max_polls):
        state_response = api("GET", "/api/2.2/jobs/runs/get", params={"run_id": run_id})
        state = state_response.get("state") if isinstance(state_response, dict) else None
        if not isinstance(state, dict):
            raise RuntimeError("Missing Databricks job status")
        lifecycle = state.get("life_cycle_state")
        if lifecycle in ("TERMINATED", "INTERNAL_ERROR", "SKIPPED", "BLOCKED"):
            if state.get("result_state") != "SUCCESS":
                raise RuntimeError("Databricks 30-case job failed: " + str(state.get("result_state") or lifecycle)[:50])
            tasks = state_response.get("tasks", []) if isinstance(state_response, dict) else []
            if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0].get("run_id"), int):
                raise RuntimeError("Missing one execution task")
            out = api("GET", "/api/2.2/jobs/runs/get-output", params={"run_id": tasks[0]["run_id"]})
            raw = (out.get("notebook_output") or {}).get("result") if isinstance(out, dict) else None
            verified = verify_result(raw)
            print("MUSITU_AXIOM_DATABRICKS_LIVE_CAPTURE_30_VERIFIED", flush=True)
            print("MUSITU_AXIOM_LIVE_CAPTURE_30_EVIDENCE=" + json.dumps(verified, sort_keys=True), flush=True)
            return run_id, verified
        if lifecycle not in ("PENDING", "QUEUED", "RUNNING", "TERMINATING", "WAITING_FOR_RETRY"):
            raise RuntimeError("Unexpected Databricks job state")
        if poll < max_polls - 1:
            sleep(15)
    raise RuntimeError("Databricks job exceeded polling window; server timeout is 900 seconds")


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Refusing execution outside isolated pilot branch")
    execute(make_api(os.environ["DATABRICKS_TOKEN"]))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, KeyError, OSError) as exc:
        print("MUSITU_AXIOM_LIVE_CAPTURE_30_RUN_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
