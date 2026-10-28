"""Persist independently re-read Axiom 30-case Databricks numerical result into MLflow.

No additional Databricks Jobs runs or compute starts. One fail-closed MLflow
experiment and one run. Source Axiom outputs remain non-certified snapshots.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from databricks_import import validate_username
from databricks_livecapture_run import verify_result
from databricks_scale_run import make_api as make_jobs_api
from tracking import make_api as make_mlflow_api

RUN_ID = 645552668907468
EXPERIMENT_NAME = "MLflow_30_Axiom_Live_Captures_20261028"
SOURCE_SHA256 = "0d2738b4271e3cdd2ac82064b8a3b99f963f58df973d046c7322a9e5ee4935e4"


def persist_verified_capture(jobs, mlflow) -> dict:
    metadata = jobs("GET", "/api/2.2/jobs/runs/get", params={"run_id": RUN_ID})
    if not isinstance(metadata, dict):
        raise RuntimeError("Missing Databricks job evidence")
    state = metadata.get("state")
    if (not isinstance(state, dict) or
        state.get("life_cycle_state") != "TERMINATED" or
        state.get("result_state") != "SUCCESS"):
        raise RuntimeError("Databricks job has not succeeded")
    tasks = metadata.get("tasks")
    if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0].get("run_id"), int):
        raise RuntimeError("Expected one completed Databricks task")
    output = jobs("GET", "/api/2.2/jobs/runs/get-output", params={"run_id": tasks[0]["run_id"]})
    notebook_data = (output.get("notebook_output") or {}).get("result") if isinstance(output, dict) else None
    verified = verify_result(notebook_data)

    identity = mlflow("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(identity.get("userName") if isinstance(identity, dict) else None)
    exp_name = f"/Users/{username}/MUSITU_AXIOM_PRIVATE_PILOT_20261027/{EXPERIMENT_NAME}"
    existing = mlflow("GET", "/api/2.0/mlflow/experiments/get-by-name",
                      params={"experiment_name": exp_name})
    if existing is not None:
        raise RuntimeError("Axiom 30-case MLflow experiment already exists; refusing duplicate")

    experiment = mlflow("POST", "/api/2.0/mlflow/experiments/create", payload={
        "name": exp_name,
        "tags": [
            {"key": "musitu.test_type", "value": "live_service_captured_snapshots"},
            {"key": "musitu.axiom_production_connection", "value": "false"},
        ],
    })
    experiment_id = experiment.get("experiment_id") if isinstance(experiment, dict) else None
    if not isinstance(experiment_id, str) or not experiment_id.isdigit():
        raise RuntimeError("MLflow experiment ID missing")

    started = mlflow("POST", "/api/2.0/mlflow/runs/create", payload={
        "experiment_id": experiment_id,
        "start_time": int(time.time()*1000),
        "tags": [
            {"key": "mlflow.runName", "value": "Axiom_30_Live_Service_Snapshot_Databricks_Parity"},
            {"key": "musitu.databricks_job_run_id", "value": str(RUN_ID)},
        ],
    })
    info = (started.get("run") or {}).get("info") if isinstance(started, dict) else None
    mlflow_id = info.get("run_id") if isinstance(info, dict) else None
    if not isinstance(mlflow_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,80}", mlflow_id):
        raise RuntimeError("MLflow run ID missing or malformed")
    metrics = {
        "total_cases": float(verified["total"]),
        "passed_cases": float(verified["passed"]),
        "failed_cases": float(verified["failed"]),
        "max_absolute_error": float(verified["max_abs_error"]),
        "npv_cases": float(verified["operations"]["finance.npv"]),
        "option_cases": float(verified["operations"]["finance.black_scholes"]),
        "var_cases": float(verified["operations"]["finance.var_historical"]),
    }
    timestamp = int(time.time()*1000)
    mlflow("POST", "/api/2.0/mlflow/runs/log-batch", payload={
        "run_id": mlflow_id,
        "metrics": [{"key": k, "value": v, "timestamp": timestamp, "step": 0}
                    for k, v in metrics.items()],
        "params": [
            {"key": "databricks_job_run_id", "value": str(RUN_ID)},
            {"key": "notebook_source_sha256", "value": SOURCE_SHA256},
            {"key": "fixture_result_sha256", "value": verified["fixture_result_sha256"]},
            {"key": "live_axiom_called_from_databricks", "value": "false"},
            {"key": "axiom_verified_field", "value": "null"},
            {"key": "execution_environment", "value": "databricks_serverless_jobs"},
        ],
        "tags": [{"key": "musitu.scope", "value": "synthetic_finance_snapshot_parity_only"}],
    })
    mlflow("POST", "/api/2.0/mlflow/runs/update", payload={
        "run_id": mlflow_id, "status": "FINISHED", "end_time": int(time.time()*1000),
    })
    stored = mlflow("GET", "/api/2.0/mlflow/runs/get", params={"run_id": mlflow_id})
    record = stored.get("run") if isinstance(stored, dict) else None
    stored_info = record.get("info") if isinstance(record, dict) else None
    if (not isinstance(stored_info, dict) or stored_info.get("run_id") != mlflow_id
            or stored_info.get("status") != "FINISHED"):
        raise RuntimeError("MLflow final run readback failed")
    observed = {m.get("key"): m.get("value") for m in (record.get("data") or {}).get("metrics", [])}
    if any(observed.get(key) != value for key, value in metrics.items()):
        raise RuntimeError("MLflow metric readback mismatch")
    return {"databricks_run_id": RUN_ID, "mlflow_run_id": mlflow_id,
            "mlflow_experiment_id": experiment_id, "metrics": metrics,
            "evidence_sha256": verified["fixture_result_sha256"]}


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Refusing operation outside isolated GitHub branch")
    token = os.environ["DATABRICKS_TOKEN"]
    result = persist_verified_capture(make_jobs_api(token), make_mlflow_api(token))
    print("MUSITU_AXIOM_30_CASE_REAL_DATABRICKS_MLFLOW_VERIFIED")
    print("DATABRICKS_JOB_ID=" + str(result["databricks_run_id"]))
    print("MLFLOW_EXPERIMENT_ID=" + result["mlflow_experiment_id"])
    print("MLFLOW_RUN_ID=" + result["mlflow_run_id"])
    print("MLFLOW_VERIFIED_METRICS=" + json.dumps(result["metrics"], sort_keys=True))
    print("DATABRICKS_COMPUTE_NOT_STARTED_BY_TRACKING")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, KeyError, OSError) as error:
        print("MUSITU_AXIOM_30_CASE_MLFLOW_FAILED: " + str(error), file=sys.stderr)
        sys.exit(1)
