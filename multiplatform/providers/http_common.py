from __future__ import annotations
import hashlib
import json
import time
import urllib.error
import urllib.request
from typing import Any, Mapping

def sha256_json(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()
    return hashlib.sha256(blob).hexdigest()

def post_json(url: str, payload: Mapping[str, Any], headers: Mapping[str, str], timeout: float):
    body = json.dumps(payload, separators=(",", ":")).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={**headers, "content-type":"application/json"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status, response_headers = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status, response_headers = e.read(), e.code, dict(e.headers)
    elapsed_ms = (time.perf_counter() - started) * 1000
    try:
        data = json.loads(raw or b"null")
    except Exception:
        data = {"raw": raw.decode("utf-8","replace")}
    return status, response_headers, data, elapsed_ms

def require_secret(name: str) -> str:
    import os
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"MISSING_PROVIDER_SECRET:{name}")
    return value
