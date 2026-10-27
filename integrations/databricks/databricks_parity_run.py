"""One-time Databricks Spark confirmation of captured MUSITU Axiom outputs.

This is NOT a live Axiom MCP connection or a production finance certification.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from databricks_import import PILOT_FOLDER, validate_username
from databricks_scale_run import make_api

NAME="03_musitu_axiom_parity"
TOKEN="musitu-axiom-databricks-parity-20261027-v1"


def build_parity_job(path: str) -> dict:
    if not re.fullmatch(r"/Users/[A-Za-z0-9._%+@-]+/MUSITU_AXIOM_PRIVATE_PILOT_20261027/03_musitu_axiom_parity",path):
        raise ValueError("Unexpected Databricks notebook path")
    return {
        "run_name":"MUSITU_AXIOM_FINANCE_PARITY_20261027",
        "idempotency_token":TOKEN,
        "timeout_seconds":900,
        "tasks":[{
            "task_key":"axiom_snapshot_parity",
            "notebook_task":{"notebook_path":path,"source":"WORKSPACE"},
            "timeout_seconds":750,
            "max_retries":0,
        }],
    }


def _verify_notebook_result(text):
    try:
        data=json.loads(text)
    except (TypeError,ValueError):
        raise RuntimeError("Malformed Databricks parity result") from None
    if not isinstance(data,dict):
        raise RuntimeError("Databricks parity result is not an object")
    required={
        "total":14,"passed":14,"failed":0,
        "put_call_parity_passed":True,
        "invalid_option_parameter_rejected":True,
        "databricks_spark_aggregation":"VERIFIED",
        "live_axiom_mcp_called_from_databricks":False,
    }
    for k,v in required.items():
        if data.get(k)!=v:
            raise RuntimeError("Parity evidence check failed: "+k)
    if not re.fullmatch(r"[a-f0-9]{64}",data.get("fixture_and_result_sha256","")):
        raise RuntimeError("Invalid parity evidence hash")
    return data


def run_parity(api,sleep=time.sleep,*,max_polls=70):
    me=api("GET","/api/2.0/preview/scim/v2/Me")
    username=validate_username(me.get("userName") if isinstance(me,dict) else None)
    path=f"/Users/{username}/{PILOT_FOLDER}/{NAME}"
    status=api("GET","/api/2.0/workspace/get-status",params={"path":path})
    if not isinstance(status,dict) or status.get("object_type")!="NOTEBOOK" or status.get("language")!="PYTHON":
        raise RuntimeError("Parity notebook not imported or unexpected type")
    submitted=api("POST","/api/2.2/jobs/runs/submit",payload=build_parity_job(path))
    run_id=submitted.get("run_id") if isinstance(submitted,dict) else None
    if not isinstance(run_id,int):
        raise RuntimeError("Did not receive Databricks run ID")
    print("MUSITU_AXIOM_PARITY_DATABRICKS_RUN_ID="+str(run_id),flush=True)
    for i in range(max_polls):
        record=api("GET","/api/2.2/jobs/runs/get",params={"run_id":run_id})
        state=record.get("state") if isinstance(record,dict) else None
        if not isinstance(state,dict):
            raise RuntimeError("Missing Databricks parity state")
        life=state.get("life_cycle_state")
        if life in ("TERMINATED","INTERNAL_ERROR","SKIPPED","BLOCKED"):
            if state.get("result_state")!="SUCCESS":
                raise RuntimeError("Parity notebook did not complete: "+str(state.get("result_state") or life)[:50])
            tasks=record.get("tasks")
            if not isinstance(tasks,list) or len(tasks)!=1 or not isinstance(tasks[0].get("run_id"),int):
                raise RuntimeError("Missing parity task ID")
            result=api("GET","/api/2.2/jobs/runs/get-output",params={"run_id":tasks[0]["run_id"]})
            output=(result.get("notebook_output") or {}).get("result") if isinstance(result,dict) else None
            verified=_verify_notebook_result(output)
            print("MUSITU_AXIOM_REAL_DATABRICKS_PARITY_14_OF_14_PASS",flush=True)
            print("MUSITU_AXIOM_PARITY_DATA="+json.dumps(verified,sort_keys=True),flush=True)
            return run_id,verified
        if life not in ("PENDING","QUEUED","RUNNING","TERMINATING","WAITING_FOR_RETRY"):
            raise RuntimeError("Unexpected Databricks parity lifecycle")
        if i<max_polls-1:sleep(15)
    raise RuntimeError("Parity polling timed out; server-side timeout set to 900s")


def main():
    if os.environ.get("GITHUB_REF")!="refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Unapproved GitHub branch")
    rid,result=run_parity(make_api(os.environ["DATABRICKS_TOKEN"]))
    return 0 if rid and result else 1


if __name__=="__main__":
    try:sys.exit(main())
    except (ValueError,RuntimeError,KeyError,OSError) as exc:
        print("MUSITU_AXIOM_PARITY_RUN_FAILED: "+str(exc),file=sys.stderr)
        sys.exit(1)
