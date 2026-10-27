"""Attest a completed Databricks Spark run in Databricks MLflow via GitHub secret.

No Databricks compute runs in this workflow; the evidence comes from the
already completed serverless Jobs run and its notebook exit payload.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from databricks_scale_run import _check_results, make_api as jobs_api
from tracking import make_api as tracking_api
from databricks_import import validate_username

RUN_ID = 605796907394973
SOURCE_SHA256 = "8d913f06a08e8f2eee4e41f7d7ff91601447928302930200d62520cc95d80830"
EXPERIMENT_BASENAME = "MLflow_Real_Spark_Scale_Evidence_20261027"


def persist_scale_evidence(jobs, mlflow) -> dict:
    metadata = jobs("GET", "/api/2.2/jobs/runs/get", params={"run_id": RUN_ID})
    state = metadata.get("state") if isinstance(metadata, dict) else None
    if (not isinstance(state, dict) or state.get("life_cycle_state") != "TERMINATED"
            or state.get("result_state") != "SUCCESS"):
        raise RuntimeError("Original Databricks run was not independently successful")
    tasks = metadata.get("tasks")
    if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0].get("run_id"), int):
        raise RuntimeError("Expected exactly one Spark task")
    task_output = jobs("GET", "/api/2.2/jobs/runs/get-output", params={"run_id": tasks[0]["run_id"]})
    encoded = (task_output.get("notebook_output") or {}).get("result") if isinstance(task_output, dict) else None
    result = _check_results(encoded)

    identity = mlflow("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(identity.get("userName") if isinstance(identity, dict) else None)
    name = f"/Users/{username}/MUSITU_AXIOM_PRIVATE_PILOT_20261027/{EXPERIMENT_BASENAME}"
    existing = mlflow("GET", "/api/2.0/mlflow/experiments/get-by-name", params={"experiment_name": name})
    if existing is not None:
        raise RuntimeError("Spark MLflow experiment already exists; refusing duplicate writes")
    experiment = mlflow("POST", "/api/2.0/mlflow/experiments/create", payload={
        "name": name,
        "tags": [
            {"key": "musitu.source", "value": "authentic-databricks-serverless-synthetic"},
            {"key": "musitu.production_qualification", "value": "false"},
        ],
    })
    experiment_id = experiment.get("experiment_id") if isinstance(experiment, dict) else None
    if not isinstance(experiment_id, str) or not experiment_id.isdigit():
        raise RuntimeError("MLflow did not return a valid experiment ID")
    opened = mlflow("POST", "/api/2.0/mlflow/runs/create", payload={
        "experiment_id": experiment_id, "start_time": int(time.time()*1000),
        "tags": [
            {"key": "mlflow.runName", "value": "MUSITU_Axiom_1M_Spark_Verification"},
            {"key": "musitu.databricks_job_run_id", "value": str(RUN_ID)},
            {"key": "musitu.synthetic_only", "value": "true"},
        ],
    })
    info = (opened.get("run") or {}).get("info") if isinstance(opened, dict) else None
    mlflow_run_id = info.get("run_id") if isinstance(info, dict) else None
    if not isinstance(mlflow_run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,80}", mlflow_run_id):
        raise RuntimeError("MLflow did not return a valid run ID")
    metrics = {"record_total": 0., "planted_anomalies": 0., "detected_anomalies": 0.,
               "false_positive_total": 0., "false_negative_total": 0.}
    for row in result["results"]:
        n = row["rows"]
        metrics["record_total"] += n
        metrics["planted_anomalies"] += row["planted_anomalies"]
        metrics["detected_anomalies"] += row["detected_anomalies"]
        metrics["false_positive_total"] += row["false_positives"]
        metrics["false_negative_total"] += row["false_negatives"]
        metrics["throughput_" + str(n)] = float(row["throughput_rows_per_sec"])
        metrics["duration_sec_" + str(n)] = float(row["elapsed_seconds"])
    now = int(time.time()*1000)
    mlflow("POST", "/api/2.0/mlflow/runs/log-batch", payload={
        "run_id": mlflow_run_id,
        "metrics": [{"key": k, "value": float(v), "timestamp": now, "step": 0} for k, v in metrics.items()],
        "params": [
            {"key": "databricks_jobs_run_id", "value": str(RUN_ID)},
            {"key": "synthetic_notebook_sha256", "value": SOURCE_SHA256},
            {"key": "spark_verdict_sha256", "value": result["evidence_sha256"]},
            {"key": "spark_version", "value": str(result.get("spark_runtime", "unknown"))},
            {"key": "execution_environment", "value": "databricks_serverless_jobs"},
            {"key": "production_axiom_called", "value": "false"},
        ],
        "tags": [
            {"key": "musitu.verified_source", "value": "true"},
            {"key": "musitu.qa_level", "value": "synthetic_pilot_only"},
        ],
    })
    mlflow("POST", "/api/2.0/mlflow/runs/update", payload={
        "run_id": mlflow_run_id, "status": "FINISHED", "end_time": int(time.time()*1000)
    })
    stored = mlflow("GET", "/api/2.0/mlflow/runs/get", params={"run_id": mlflow_run_id})
    stored_run = stored.get("run") if isinstance(stored, dict) else None
    stored_info = stored_run.get("info") if isinstance(stored_run, dict) else None
    if not isinstance(stored_info, dict) or stored_info.get("run_id") != mlflow_run_id or stored_info.get("status") != "FINISHED":
        raise RuntimeError("MLflow readback failed")
    actual = {x.get("key"): x.get("value") for x in (stored_run.get("data") or {}).get("metrics", [])}
    if any(actual.get(k) != float(v) for k, v in metrics.items()):
        raise RuntimeError("MLflow metric readback mismatch")
    return {"mlflow_experiment_id": experiment_id, "mlflow_run_id": mlflow_run_id,
            "databricks_run_id": RUN_ID, "metrics": metrics}


def main():
    token = os.environ["DATABRICKS_TOKEN"]
    output = persist_scale_evidence(jobs_api(token), tracking_api(token))
    print("MUSITU_DATABRICKS_REAL_SPARK_MLFLOW_EVIDENCE_VERIFIED")
    print("DATABRICKS_RUN_ID=" + str(output["databricks_run_id"]))
    print("MLFLOW_EXPERIMENT_ID=" + output["mlflow_experiment_id"])
    print("MLFLOW_RUN_ID=" + output["mlflow_run_id"])
    print("MLFLOW_VERIFIED_METRICS=" + json.dumps(output["metrics"], sort_keys=True))
    print("DATABRICKS_COMPUTE_NOT_STARTED_BY_TRACKING")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError, KeyError) as exc:
        print("MUSITU_DATABRICKS_MLFLOW_ATTESTATION_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
