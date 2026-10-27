"""Import private point-in-time Axiom parity notebook, with no overwrite and no compute."""
from __future__ import annotations

import base64
import hashlib
import os
import sys
from pathlib import Path

from databricks_import import PILOT_FOLDER, make_databricks_api, validate_username

TARGET="03_musitu_axiom_parity"

def import_parity(api, source: bytes):
    if not isinstance(source, bytes) or not source.startswith(b"# Databricks notebook source\n") or len(source)>100_000:
        raise ValueError("Refusing non-notebook or oversized source")
    me=api("GET","/api/2.0/preview/scim/v2/Me")
    username=validate_username(me.get("userName") if isinstance(me,dict) else None)
    folder=f"/Users/{username}/{PILOT_FOLDER}"
    target=f"{folder}/{TARGET}"
    existing=api("GET","/api/2.0/workspace/get-status",params={"path":target})
    if existing is not None:
        raise RuntimeError("Parity notebook already exists; refusing overwrite")
    api("POST","/api/2.0/workspace/mkdirs",payload={"path":folder})
    api("POST","/api/2.0/workspace/import",payload={
        "path":target,"format":"SOURCE","language":"PYTHON",
        "content":base64.b64encode(source).decode("ascii"),"overwrite":False
    })
    state=api("GET","/api/2.0/workspace/get-status",params={"path":target})
    if not isinstance(state,dict) or state.get("object_type")!="NOTEBOOK" or state.get("language")!="PYTHON":
        raise RuntimeError("Databricks did not confirm parity notebook import")
    if not isinstance(state.get("object_id"),int):
        raise RuntimeError("No notebook object ID")
    return {"object_id":state["object_id"],"source_sha256":hashlib.sha256(source).hexdigest()}

def main():
    p=Path(__file__).parent/"notebooks"/"03_musitu_axiom_parity.py"
    result=import_parity(make_databricks_api(os.environ["DATABRICKS_TOKEN"]),p.read_bytes())
    print("MUSITU_AXIOM_DATABRICKS_PARITY_NOTEBOOK_IMPORTED")
    print("DATABRICKS_PARITY_OBJECT_ID="+str(result["object_id"]))
    print("DATABRICKS_PARITY_SOURCE_SHA256="+result["source_sha256"])
    print("DATABRICKS_COMPUTE_NOT_STARTED")
    return 0

if __name__=="__main__":
    try:
        sys.exit(main())
    except (KeyError,OSError,ValueError,RuntimeError) as exc:
        print("MUSITU_AXIOM_PARITY_IMPORT_FAILED: "+str(exc),file=sys.stderr)
        sys.exit(1)
