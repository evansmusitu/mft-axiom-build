"""Read-only verification of the persisted MUSITU Databricks synthetic notebook.

No Databricks compute is started; credentials and personal identity never print.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from databricks_import import validate_username, HOST, PILOT_FOLDER, NOTEBOOK_BASENAME

READ_ONLY_ENDPOINTS = frozenset({
    "/api/2.0/preview/scim/v2/Me",
    "/api/2.0/workspace/get-status",
    "/api/2.0/workspace/export",
})


def verify_persisted_notebook(api, expected_source: bytes) -> dict:
    """Verify stored object and round-trip SOURCE bytes, without modifying workspace."""
    user = api("GET", "/api/2.0/preview/scim/v2/Me")
    if not isinstance(user, dict):
        raise RuntimeError("Unable to inspect authenticated Databricks user")
    username = validate_username(user.get("userName"))
    target = f"/Users/{username}/{PILOT_FOLDER}/{NOTEBOOK_BASENAME}"

    status = api("GET", "/api/2.0/workspace/get-status", params={"path": target})
    if not isinstance(status, dict) or status.get("object_type") != "NOTEBOOK" or status.get("language") != "PYTHON":
        raise RuntimeError("Target is not a verified Python notebook")
    if not isinstance(status.get("object_id"), int):
        raise RuntimeError("Target has no notebook object ID")

    record = api("GET", "/api/2.0/workspace/export", params={"path": target, "format": "SOURCE"})
    if not isinstance(record, dict) or not isinstance(record.get("content"), str):
        raise RuntimeError("Unexpected workspace export response")
    try:
        stored = base64.b64decode(record["content"], validate=True)
    except (binascii.Error, ValueError):
        raise RuntimeError("Malformed workspace export response") from None
    if not stored or len(stored) > 100_000:
        raise RuntimeError("Unexpected exported notebook size")

    normalize = lambda x: x.replace(b"\r\n", b"\n").rstrip(b"\n") + b"\n"
    if normalize(stored) != normalize(expected_source):
        raise RuntimeError("Notebook source content mismatch")
    return {
        "result": "VERIFIED_SOURCE_MATCH",
        "object_id": status["object_id"],
        "source_sha256": hashlib.sha256(normalize(stored)).hexdigest(),
    }


def make_readonly_api(token: str):
    if not token or "\n" in token or "\r" in token:
        raise ValueError("Missing or malformed Databricks token")

    def api(method: str, path: str, params: dict | None = None):
        if method != "GET" or path not in READ_ONLY_ENDPOINTS:
            raise RuntimeError("Non-read-only Databricks operation refused")
        url = HOST + path + ("?" + urlencode(params) if params else "")
        request = Request(url, method="GET", headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=25) as response:
                if response.status != 200:
                    raise RuntimeError(f"Databricks read-only API HTTP {response.status}")
                return json.loads(response.read(150_000).decode("utf-8"))
        except HTTPError as exc:
            raise RuntimeError(f"Databricks read-only API HTTP {exc.code}") from None
        except URLError:
            raise RuntimeError("Databricks read-only API unavailable") from None

    return api


def main() -> int:
    notebook = Path(__file__).resolve().parent / "notebooks" / "01_musitu_axiom_selfcontained.py"
    result = verify_persisted_notebook(
        make_readonly_api(os.environ["DATABRICKS_TOKEN"]), notebook.read_bytes()
    )
    print("MUSITU_DATABRICKS_PERSISTED_NOTEBOOK_SOURCE_VERIFIED")
    print("DATABRICKS_NOTEBOOK_OBJECT_ID=" + str(result["object_id"]))
    print("MUSITU_DATABRICKS_SOURCE_SHA256=" + result["source_sha256"])
    print("DATABRICKS_COMPUTE_NOT_STARTED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError, KeyError) as exc:
        print("MUSITU_DATABRICKS_PERSISTENCE_CHECK_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)
