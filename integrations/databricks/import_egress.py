"""Non-overwriting upload of public MCP network probe to private Databricks home."""
from __future__ import annotations
import base64
import hashlib
import os
import sys
from pathlib import Path

from databricks_import import PILOT_FOLDER, make_databricks_api, validate_username

TARGET = "05_musitu_axiom_mcp_egress"
SOURCE_NAME = TARGET + ".py"


def import_probe(api, source: bytes) -> dict:
    if not isinstance(source, bytes) or not source.startswith(b"# Databricks notebook source\n") or not (100 < len(source) <= 100_000):
        raise ValueError("Unexpected Databricks MCP probe source")
    me = api("GET", "/api/2.0/preview/scim/v2/Me")
    user = validate_username(me.get("userName") if isinstance(me, dict) else None)
    folder = f"/Users/{user}/{PILOT_FOLDER}"
    path = folder + "/" + TARGET
    existing = api("GET", "/api/2.0/workspace/get-status", params={"path": path})
    if existing is not None:
        raise RuntimeError("Private MCP probe notebook already exists; refusing overwrite")
    api("POST", "/api/2.0/workspace/mkdirs", payload={"path": folder})
    api("POST", "/api/2.0/workspace/import", payload={
        "path": path,
        "format": "SOURCE",
        "language": "PYTHON",
        "content": base64.b64encode(source).decode("ascii"),
        "overwrite": False,
    })
    stored = api("GET", "/api/2.0/workspace/get-status", params={"path": path})
    if not isinstance(stored, dict) or stored.get("object_type") != "NOTEBOOK" or stored.get("language") != "PYTHON" or not isinstance(stored.get("object_id"), int):
        raise RuntimeError("Databricks did not verify MCP probe notebook creation")
    return {"object_id": stored["object_id"], "source_sha256": hashlib.sha256(source).hexdigest()}


def main():
    src = (Path(__file__).parent / "notebooks" / SOURCE_NAME).read_bytes()
    result = import_probe(make_databricks_api(os.environ["DATABRICKS_TOKEN"]), src)
    print("MUSITU_AXIOM_DATABRICKS_PUBLIC_MCP_PROBE_IMPORTED")
    print("DATABRICKS_MCP_PROBE_OBJECT_ID=" + str(result["object_id"]))
    print("DATABRICKS_MCP_PROBE_SOURCE_SHA256=" + result["source_sha256"])
    print("DATABRICKS_COMPUTE_NOT_STARTED_BY_IMPORT")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyError, OSError, ValueError, RuntimeError) as error:
        print("MUSITU_AXIOM_MCP_PROBE_IMPORT_FAILED:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
