"""Execute exactly one bounded Databricks serverless Spark scale notebook and verify output."""
from __future__ import annotations

import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from databricks_import import HOST, PILOT_FOLDER, validate_username

TARGET = "02_musitu_axiom_spark_scale"
IDEMPOTENCY = "musitu-axiom-databricks-spark-20261027-v1"
ROUTES = frozenset({
    ("GET", "/api/2.0/preview/scim/v2/Me"),
    ("GET", "/api/2.0/workspace/get-status"),
    ("POST", "/api/2.2/jobs/runs/submit"),
    ("GET", "/api/2.2/jobs/runs/get"),
    ("GET", "/api/2.2/jobs/runs/get-output"),
})


def build_scale_submit(notebook_path: str) -> dict:
    if not re.fullmatch(r"/Users/[A-Za-z0-9._%+@-]+/MUSITU_AXIOM_PRIVATE_PILOT_20261027/02_musitu_axiom_spark_scale", notebook_path):
        raise ValueError("Refusing non-pilot notebook")
    return {
        "run_name": "MUSITU_AXIOM_SYNTHETIC_SPARK_SCALE_20261027",
        "idempotency_token": IDEMPOTENCY,
        "timeout_seconds": 1500,
        "tasks": [{
            "task_key": "synthetic_spark_scale",
            "notebook_task": {"notebook_path": notebook_path, "source": "WORKSPACE"},
            "timeout_seconds": 1200,
            "max_retries": 0,
        }],
    }


def _check_results(payload: str) -> dict:
    try:
        data = json.loads(payload)
    except (TypeError, ValueError):
        raise RuntimeError("Missing or invalid notebook exit JSON") from None
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list) or len(results) != 2:
        raise RuntimeError("Missing two scale measurements")
    for item, n in zip(results, (100_000, 1_000_000)):
        expected = (n - 1) // 17 + 1
        if (not isinstance(item, dict) or
            item.get("rows") != n or
            item.get("planted_anomalies") != expected or
            item.get("detected_anomalies") != expected or
            item.get("false_negatives") != 0 or
            item.get("false_positives") != 0):
            raise RuntimeError("Spark verification accuracy or row counts failed")
    if (data.get("decimal_control_passed") is not True or
        data.get("floating_point_drift_detected") is not True or
        data.get("axiom_production_called") is not False or
        not re.fullmatch(r"[0-9a-f]{64}", data.get("evidence_sha256", ""))):
        raise RuntimeError("Spark evidence constraints not met")
    return data


def execute_scale(api, sleep=time.sleep, *, max_polls=95) -> tuple[int, dict]:
    me = api("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(me.get("userName") if isinstance(me, dict) else None)
    path = f"/Users/{username}/{PILOT_FOLDER}/{TARGET}"
    status = api("GET", "/api/2.0/workspace/get-status", params={"path": path})
    if not isinstance(status, dict) or status.get("object_type") != "NOTEBOOK" or status.get("language") != "PYTHON":
        raise RuntimeError("The expected private Spark pilot notebook is not imported")
    submitted = api("POST", "/api/2.2/jobs/runs/submit", payload=build_scale_submit(path))
    run_id = submitted.get("run_id") if isinstance(submitted, dict) else None
    if not isinstance(run_id, int):
        raise RuntimeError("No valid Databricks run id returned")
    print(f"MUSITU_DATABRICKS_SPARK_RUN_ID={run_id}", flush=True)
    for i in range(max_polls):
        metadata = api("GET", "/api/2.2/jobs/runs/get", params={"run_id": run_id})
        state = metadata.get("state") if isinstance(metadata, dict) else None
        if not isinstance(state, dict):
            raise RuntimeError("Unexpected Spark run state")
        lifecycle = state.get("life_cycle_state")
        if lifecycle in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR", "BLOCKED"):
            if state.get("result_state") != "SUCCESS":
                raise RuntimeError("Spark job did not complete: " + str(state.get("result_state") or lifecycle)[:40])
            tasks = metadata.get("tasks") if isinstance(metadata, dict) else None
            if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0].get("run_id"), int):
                raise RuntimeError("Completed job did not contain one task run id")
            task_out = api("GET", "/api/2.2/jobs/runs/get-output", params={"run_id": tasks[0]["run_id"]})
            text = (task_out.get("notebook_output") or {}).get("result") if isinstance(task_out, dict) else None
            verdict = _check_results(text)
            print("MUSITU_DATABRICKS_SPARK_SCALE_VERIFIED", flush=True)
            print("MUSITU_DATABRICKS_SPARK_METRICS=" + json.dumps(verdict, sort_keys=True), flush=True)
            return run_id, verdict
        if lifecycle not in ("PENDING", "QUEUED", "RUNNING", "TERMINATING", "WAITING_FOR_RETRY"):
            raise RuntimeError("Unrecognized Spark job state")
        if i < max_polls - 1:
            sleep(15)
    raise RuntimeError("Spark job exceeded polling window; server-side timeout is 1500 seconds")


def make_api(token: str):
    if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
        raise ValueError("Missing Databricks workspace PAT")
    def api(method, path, payload=None, params=None):
        if (method, path) not in ROUTES or (method=="GET" and payload is not None) or (method=="POST" and params is not None):
            raise ValueError("API operation not approved in pilot")
        url = HOST + path + (("?" + urlencode(params)) if params else "")
        data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        req = Request(url, method=method, data=data, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urlopen(req, timeout=30) as response:
                if response.status not in (200,201):
                    raise RuntimeError(f"Databricks HTTP status {response.status}")
                raw = response.read(350_000)
                return json.loads(raw.decode()) if raw else {}
        except HTTPError as exc:
            if method=="GET" and path=="/api/2.0/workspace/get-status" and exc.code==404:
                return None
            raise RuntimeError(f"Databricks endpoint HTTP {exc.code}") from None
        except URLError:
            raise RuntimeError("Databricks API connection failed") from None
    return api


def main() -> int:
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Unexpected branch for cost-bearing Spark workload")
    run_id, result = execute_scale(make_api(os.environ["DATABRICKS_TOKEN"]))
    return 0 if run_id and result else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, KeyError, OSError) as exc:
        print("MUSITU_DATABRICKS_SPARK_SCALE_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
