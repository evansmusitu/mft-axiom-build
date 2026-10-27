"""Single idempotent Databricks serverless synthetic notebook smoke job.

This script can start Databricks Jobs serverless compute and consume trial credits.
Explicitly gate the corresponding Actions job by a commit-message tag.
Never invokes production Axiom, creates a persistent cluster, or prints secrets.
"""
from __future__ import annotations

import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from databricks_import import HOST, PILOT_FOLDER, NOTEBOOK_BASENAME, validate_username

APPROVED_ROUTES = frozenset({
    ("GET", "/api/2.0/preview/scim/v2/Me"),
    ("POST", "/api/2.2/jobs/runs/submit"),
    ("GET", "/api/2.2/jobs/runs/get"),
})
IDEMPOTENCY = "musitu-axiom-databricks-smoke-20261027-v1"


def _validate_job_api_route(method: str, path: str) -> None:
    if (method, path) not in APPROVED_ROUTES:
        raise ValueError("Non-allowlisted Databricks operation")


def build_submit(notebook_path: str) -> dict:
    if not notebook_path.startswith("/Users/"):
        raise ValueError("Notebook must reside in user workspace")
    prefix = notebook_path.removeprefix("/Users/")
    username, separator, rest = prefix.partition("/")
    if not separator or validate_username(username) != username:
        raise ValueError("Bad workspace user path")
    if rest != f"{PILOT_FOLDER}/{NOTEBOOK_BASENAME}":
        raise ValueError("Not the verified synthetic notebook")
    return {
        "run_name": "MUSITU_AXIOM_PRIVATE_SYNTHETIC_SMOKE_20261027",
        "idempotency_token": IDEMPOTENCY,
        "timeout_seconds": 900,
        "tasks": [{
            "task_key": "synthetic_smoke",
            "description": "Synthetic calculations only; no production credentials in notebook",
            "notebook_task": {"notebook_path": notebook_path, "source": "WORKSPACE"},
            "timeout_seconds": 600,
            "max_retries": 0,
        }],
    }


def execute_once(api, sleep=time.sleep, *, max_polls=60) -> int:
    me = api("GET", "/api/2.0/preview/scim/v2/Me")
    if not isinstance(me, dict):
        raise RuntimeError("Databricks identity unavailable")
    username = validate_username(me.get("userName"))
    path = f"/Users/{username}/{PILOT_FOLDER}/{NOTEBOOK_BASENAME}"
    payload = build_submit(path)
    submitted = api("POST", "/api/2.2/jobs/runs/submit", payload=payload)
    if not isinstance(submitted, dict) or not isinstance(submitted.get("run_id"), int):
        raise RuntimeError("Databricks did not return a valid job run id")
    run_id = submitted["run_id"]
    print(f"MUSITU_DATABRICKS_LIVE_RUN_ID={run_id}", flush=True)

    for poll in range(max_polls):
        state_response = api("GET", "/api/2.2/jobs/runs/get", params={"run_id": run_id})
        state = state_response.get("state") if isinstance(state_response, dict) else None
        if not isinstance(state, dict):
            raise RuntimeError("Unexpected Databricks run state")
        lifecycle = state.get("life_cycle_state")
        result = state.get("result_state")
        if lifecycle in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR", "BLOCKED"):
            if result == "SUCCESS":
                print("MUSITU_DATABRICKS_SYNTHETIC_LIVE_JOB_SUCCESS", flush=True)
                return run_id
            raise RuntimeError("Databricks run ended: " + str(result or lifecycle)[:50])
        if lifecycle not in ("PENDING", "QUEUED", "RUNNING", "TERMINATING", "WAITING_FOR_RETRY", "BLOCKED"):
            raise RuntimeError("Unrecognized Databricks job life cycle")
        if poll < max_polls - 1:
            sleep(15)
    raise RuntimeError("Databricks run did not finish within polling window; job has server-side 900s timeout")


def make_api(token: str):
    if not token or "\n" in token or "\r" in token:
        raise ValueError("Missing or malformed Databricks workspace PAT")

    def api(method: str, path: str, payload=None, params=None):
        _validate_job_api_route(method, path)
        if method == "GET" and payload is not None:
            raise ValueError("Unexpected GET payload")
        if method == "POST" and params is not None:
            raise ValueError("Unexpected POST params")
        url = HOST + path + (("?" + urlencode(params)) if params else "")
        data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        request = Request(url, method=method, data=data, headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "Content-Type": "application/json",
        })
        try:
            with urlopen(request, timeout=30) as response:
                if response.status not in (200, 201):
                    raise RuntimeError("Unexpected Databricks HTTP status " + str(response.status))
                raw = response.read(200_000)
                return json.loads(raw.decode("utf-8")) if raw else {}
        except HTTPError as exc:
            # Don't print response bodies or user identities; only the status and generic Databricks error code.
            raise RuntimeError(f"Databricks {path.rsplit('/',1)[-1]} endpoint returned HTTP {exc.code}") from None
        except URLError:
            raise RuntimeError("Databricks API network connection failed") from None
    return api


def main() -> int:
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Unexpected branch for cost-bearing smoke test")
    return execute_once(make_api(os.environ["DATABRICKS_TOKEN"])) and 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, KeyError, OSError) as exc:
        print("MUSITU_DATABRICKS_LIVE_SMOKE_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
