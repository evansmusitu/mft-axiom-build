"""One-time Databricks serverless probe of public MUSITU Axiom MCP reachability.

No Axiom credentials. The notebook only sends MCP initialize and tools/list,
NEVER tools/call. The runner itself uses an allowlisted Databricks Jobs API.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from databricks_import import PILOT_FOLDER, validate_username
from databricks_scale_run import make_api

NAME = "05_musitu_axiom_mcp_egress"
IDEMPOTENCY = "musitu-axiom-databricks-public-mcp-egress-20261028-v1"
SCHEMA = "musitu.axiom.databricks.public-mcp-egress.v1"


def build_job(path: str) -> dict:
    if not re.fullmatch(
        r"/Users/[A-Za-z0-9._%+@-]+/MUSITU_AXIOM_PRIVATE_PILOT_20261027/05_musitu_axiom_mcp_egress", path
    ):
        raise ValueError("Refusing non-pilot Databricks notebook path")
    return {
        "run_name": "MUSITU_AXIOM_PUBLIC_MCP_EGRESS_20261028",
        "idempotency_token": IDEMPOTENCY,
        "timeout_seconds": 330,
        "tasks": [{
            "task_key": "public_mcp_initialize_and_list_only",
            "notebook_task": {"notebook_path": path, "source": "WORKSPACE"},
            "timeout_seconds": 240,
            "max_retries": 0,
        }],
    }


def verify_probe(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError("Invalid MCP network probe result") from None
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise RuntimeError("Unexpected MCP probe schema")
    if data.get("axiom_tool_calls_executed") != 0 or data.get("axiom_authenticated") is not False:
        raise RuntimeError("Public network probe unexpectedly used Axiom execution or credentials")
    status = data.get("status")
    if status == "REACHABLE_PUBLIC_MCP":
        if not (data.get("initialize_http") == 200 and
                data.get("initialize_supported") is True and
                data.get("tools_http") == 200 and
                type(data.get("tools_count")) is int and 0 <= data["tools_count"] <= 10000 and
                type(data.get("approved_tools_visible")) is int and 0 <= data["approved_tools_visible"] <= 3 and
                type(data.get("unrestricted_execute_advertised")) is bool):
            raise RuntimeError("Invalid reachable MCP handshake evidence")
    elif status == "BLOCKED_OR_UNSUPPORTED":
        if not (data.get("initialize_supported") is False and
                data.get("initialize_http") in (0, 400, 401, 403, 404, 405, 406, 429, 500, 502, 503, 504) and
                data.get("tools_http") is None and data.get("tools_count") is None and
                data.get("approved_tools_visible") == 0 and
                data.get("unrestricted_execute_advertised") is None):
            raise RuntimeError("Invalid blocked MCP connection evidence")
    elif status == "TOOLS_DISCOVERY_FAILED":
        if not (data.get("initialize_supported") is True and
                data.get("initialize_http") == 200 and
                data.get("tools_http") != 200 and
                data.get("tools_count") is None):
            raise RuntimeError("Invalid tools discovery failure evidence")
    else:
        raise RuntimeError("Unknown MCP probe outcome")
    return data


def execute_once(api, sleep=time.sleep, *, max_polls=20):
    identity = api("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(identity.get("userName") if isinstance(identity, dict) else None)
    path = f"/Users/{username}/{PILOT_FOLDER}/{NAME}"
    existing = api("GET", "/api/2.0/workspace/get-status", params={"path": path})
    if not isinstance(existing, dict) or existing.get("object_type") != "NOTEBOOK" or existing.get("language") != "PYTHON":
        raise RuntimeError("Expected private MCP network probe notebook is not imported")
    reply = api("POST", "/api/2.2/jobs/runs/submit", payload=build_job(path))
    run_id = reply.get("run_id") if isinstance(reply, dict) else None
    if not isinstance(run_id, int):
        raise RuntimeError("Databricks did not return a Jobs run ID")
    print("MUSITU_AXIOM_MCP_EGRESS_DATABRICKS_JOB_ID=" + str(run_id), flush=True)
    for i in range(max_polls):
        state_reply = api("GET", "/api/2.2/jobs/runs/get", params={"run_id": run_id})
        state = state_reply.get("state") if isinstance(state_reply, dict) else None
        if not isinstance(state, dict):
            raise RuntimeError("Missing Databricks network probe job state")
        lifecycle = state.get("life_cycle_state")
        if lifecycle in ("TERMINATED", "INTERNAL_ERROR", "SKIPPED", "BLOCKED"):
            if state.get("result_state") != "SUCCESS":
                raise RuntimeError("Databricks MCP egress notebook failed: " + str(state.get("result_state") or lifecycle)[:40])
            tasks = state_reply.get("tasks", []) if isinstance(state_reply, dict) else []
            if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0].get("run_id"), int):
                raise RuntimeError("Missing single MCP egress notebook task")
            output = api("GET", "/api/2.2/jobs/runs/get-output", params={"run_id": tasks[0]["run_id"]})
            raw = (output.get("notebook_output") or {}).get("result") if isinstance(output, dict) else None
            record = verify_probe(raw)
            print("MUSITU_AXIOM_DATABRICKS_MCP_EGRESS_ATTESTED", flush=True)
            print("MUSITU_AXIOM_DATABRICKS_MCP_EGRESS_RESULT=" + json.dumps(record, sort_keys=True), flush=True)
            return run_id, record
        if lifecycle not in ("PENDING", "QUEUED", "RUNNING", "TERMINATING", "WAITING_FOR_RETRY"):
            raise RuntimeError("Unknown MCP egress Jobs lifecycle")
        if i < max_polls - 1:
            sleep(15)
    raise RuntimeError("MCP probe polling timed out; Jobs server timeout is 330 seconds")


def main() -> int:
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("MCP egress probe restricted to isolated branch")
    execute_once(make_api(os.environ["DATABRICKS_TOKEN"]))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, KeyError, OSError) as error:
        print("MUSITU_AXIOM_MCP_EGRESS_PROBE_FAILED:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
