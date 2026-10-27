"""Import a separate synthetic Spark benchmark notebook, never overwriting."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from databricks_import import (
    HOST, PILOT_FOLDER, make_databricks_api, validate_username,
)

FILENAME = "02_musitu_axiom_spark_scale.py"
TARGET_BASENAME = "02_musitu_axiom_spark_scale"


def import_scale(api, source: bytes) -> dict:
    if not isinstance(source, bytes) or len(source) > 100_000 or not source.startswith(b"# Databricks notebook source\n"):
        raise ValueError("Refusing unexpected Spark benchmark source")
    me = api("GET", "/api/2.0/preview/scim/v2/Me")
    username = validate_username(me.get("userName") if isinstance(me, dict) else None)
    folder = f"/Users/{username}/{PILOT_FOLDER}"
    dest = f"{folder}/{TARGET_BASENAME}"
    existing = api("GET", "/api/2.0/workspace/get-status", params={"path": dest})
    if existing is not None:
        raise RuntimeError("Spark benchmark path already exists, refusing overwrite")
    api("POST", "/api/2.0/workspace/mkdirs", payload={"path": folder})
    api("POST", "/api/2.0/workspace/import", payload={
        "path": dest, "format": "SOURCE", "language": "PYTHON",
        "content": base64.b64encode(source).decode("ascii"),
        "overwrite": False,
    })
    status = api("GET", "/api/2.0/workspace/get-status", params={"path": dest})
    if not isinstance(status, dict) or status.get("object_type") != "NOTEBOOK" or status.get("language") != "PYTHON":
        raise RuntimeError("Databricks did not confirm imported Python notebook")
    if not isinstance(status.get("object_id"), int):
        raise RuntimeError("Databricks returned invalid notebook object ID")
    return {"object_id": status["object_id"], "source_sha256": hashlib.sha256(source).hexdigest()}


def main() -> int:
    source = (Path(__file__).parent / "notebooks" / FILENAME).read_bytes()
    result = import_scale(make_databricks_api(os.environ["DATABRICKS_TOKEN"]), source)
    print("MUSITU_DATABRICKS_SPARK_NOTEBOOK_IMPORTED")
    print("MUSITU_DATABRICKS_SPARK_OBJECT_ID=" + str(result["object_id"]))
    print("MUSITU_DATABRICKS_SPARK_SOURCE_SHA256=" + result["source_sha256"])
    print("DATABRICKS_SPARK_COMPUTE_NOT_STARTED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, KeyError, ValueError, RuntimeError) as exc:
        print("MUSITU_DATABRICKS_SPARK_IMPORT_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
