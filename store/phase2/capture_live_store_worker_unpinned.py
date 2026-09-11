#!/usr/bin/env python3
from __future__ import annotations

import email
import email.policy
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = os.environ["ACCOUNT_ID"]
WORKER = os.environ["STORE_WORKER"]
OUT = Path(os.environ.get("LIVE_MODULE_OUTPUT", "/tmp/musitu-store-live-unpinned"))
OUT.mkdir(parents=True, exist_ok=True)
EXPECTED_COMPATIBILITY_DATE = os.environ.get("EXPECTED_COMPATIBILITY_DATE", "2026-09-09")
MODULES = ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs")
AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "*/*",
    "User-Agent": "MUSITU-Store-Unpinned-Live-Capture/1.0",
}


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def request(url: str):
    req = urllib.request.Request(url, headers=AUTH, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def api_json(path: str):
    code, _, raw = request(API + path)
    if code != 200:
        raise RuntimeError(f"Cloudflare GET failed {path} HTTP {code}")
    payload = json.loads(raw)
    if payload.get("success") is not True:
        raise RuntimeError(f"Cloudflare GET unsuccessful {path}")
    return payload.get("result")


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    message = email.message_from_bytes(raw, policy=email.policy.default)
    if not message.is_multipart():
        raise RuntimeError("live Worker response is not multipart")
    parts: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        payload = part.get_payload(decode=True)
        if name and payload is not None:
            parts[str(name)] = payload
    return parts


def main() -> None:
    settings = api_json(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    compatibility_date = settings.get("compatibility_date")
    if compatibility_date != EXPECTED_COMPATIBILITY_DATE:
        raise RuntimeError(f"compatibility date drift: {compatibility_date!r} != {EXPECTED_COMPATIBILITY_DATE!r}")
    bindings = {item.get("name"): item for item in settings.get("bindings") or [] if isinstance(item, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError(f"unexpected live binding set: {sorted(bindings)}")
    if bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("text") != "production":
        raise RuntimeError("live runtime publication state is not production")

    path = f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = request(API + path)
    if code != 200:
        raise RuntimeError(f"live Worker GET failed HTTP {code}")
    content_type = headers.get("Content-Type") or headers.get("content-type") or ""
    if "multipart/" not in content_type.lower():
        raise RuntimeError(f"unexpected Worker content type: {content_type}")
    parts = parse_multipart(content_type, body)

    observed = {}
    for name in MODULES:
        if name not in parts:
            raise RuntimeError(f"live Worker missing {name}")
        raw = parts[name]
        (OUT / name).write_bytes(raw)
        observed[name] = {"sha256": sha256(raw), "bytes": len(raw)}

    report = {
        "schema": "musitu.store.live_worker_capture.unpinned.v1",
        "result": "PASS_READ_ONLY_LIVE_CAPTURE",
        "cloudflare_method": "GET_ONLY",
        "worker": WORKER,
        "compatibility_date": compatibility_date,
        "bindings": sorted(bindings),
        "modules": observed,
        "multipart_snapshot_sha256": sha256(body),
        "multipart_snapshot_bytes": len(body),
    }
    (OUT / "capture.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
