#!/usr/bin/env python3
from __future__ import annotations

import difflib
import email
import email.policy
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = os.environ["ACCOUNT_ID"]
WORKER = os.environ["STORE_WORKER"]
BASELINE = Path(os.environ["BASELINE_MODULE_ROOT"])
OUT = Path(os.environ.get("FORENSIC_OUTPUT", "/tmp/musitu-store-live-worker-forensics"))
OUT.mkdir(parents=True, exist_ok=True)
AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "*/*",
    "User-Agent": "MUSITU-Store-Live-Worker-Forensics/1.0",
}
MODULES = ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def http_get(url: str):
    request = urllib.request.Request(url, headers=AUTH, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    message = email.message_from_bytes(raw, policy=email.policy.default)
    if not message.is_multipart():
        raise RuntimeError("Cloudflare Worker response was not multipart")
    parts: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        payload = part.get_payload(decode=True)
        if name and payload is not None:
            parts[str(name)] = payload
    return parts


def scan_sensitive(text: str) -> list[str]:
    patterns = {
        "private_key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        "openai_style_key": r"\bsk-[A-Za-z0-9_-]{20,}\b",
        "aws_access_key": r"\bAKIA[0-9A-Z]{16}\b",
        "bearer_token": r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{24,}",
        "assignment_secret": r"(?i)\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['\"][^'\"]{12,}['\"]",
    }
    return [name for name, pattern in patterns.items() if re.search(pattern, text)]


def main() -> None:
    path = f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    status, headers, body = http_get(API + path)
    if status != 200:
        raise RuntimeError(f"live Worker GET failed HTTP {status}")
    content_type = headers.get("Content-Type") or headers.get("content-type") or ""
    if "multipart/" not in content_type.lower():
        raise RuntimeError(f"unexpected live Worker content type: {content_type}")
    parts = parse_multipart(content_type, body)
    missing = [name for name in MODULES if name not in parts]
    if missing:
        raise RuntimeError(f"live Worker missing expected modules: {missing}")

    report = {
        "schema": "musitu.store.phase2.live_worker_forensics.v1",
        "result": "PASS_READ_ONLY_CAPTURE",
        "cloudflare_method": "GET_ONLY",
        "worker": WORKER,
        "multipart_snapshot_sha256": sha256(body),
        "multipart_snapshot_bytes": len(body),
        "modules": {},
        "live_worker_sensitive_scan": [],
        "exact_diff_artifact_emitted": False,
    }

    for name in MODULES:
        live = parts[name]
        baseline = (BASELINE / name).read_bytes()
        report["modules"][name] = {
            "live_sha256": sha256(live),
            "live_bytes": len(live),
            "baseline_sha256": sha256(baseline),
            "baseline_bytes": len(baseline),
            "byte_identical": live == baseline,
        }

    live_worker_text = parts["worker.mjs"].decode("utf-8", "replace")
    baseline_worker_text = (BASELINE / "worker.mjs").read_text(encoding="utf-8")
    sensitive = scan_sensitive(live_worker_text)
    report["live_worker_sensitive_scan"] = sensitive

    if not sensitive:
        diff = "".join(
            difflib.unified_diff(
                baseline_worker_text.splitlines(keepends=True),
                live_worker_text.splitlines(keepends=True),
                fromfile="reconstructed-phase1-1.0.2/worker.mjs",
                tofile="live-production/worker.mjs",
                n=5,
            )
        )
        (OUT / "live-worker-vs-reconstructed-baseline.diff").write_text(diff, encoding="utf-8")
        report["exact_diff_artifact_emitted"] = True
        report["worker_diff_lines"] = len(diff.splitlines())
        report["worker_diff_sha256"] = sha256(diff.encode())
    else:
        report["worker_diff_withheld_reason"] = "potential secret-like token detected in live worker source"

    # Persist each live module only if the whole module has no high-risk secret signature.
    emitted = []
    withheld = []
    for name in MODULES:
        raw = parts[name]
        text = raw.decode("utf-8", "replace")
        hits = scan_sensitive(text)
        if hits:
            withheld.append({"module": name, "sensitive_scan_hits": hits})
        else:
            (OUT / f"live-{name}").write_bytes(raw)
            emitted.append(name)
    report["live_module_artifacts_emitted"] = emitted
    report["live_module_artifacts_withheld"] = withheld

    raw_report = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode()
    (OUT / "forensics.json").write_bytes(raw_report)
    lines = []
    for p in sorted(OUT.iterdir()):
        if p.is_file():
            raw = p.read_bytes()
            lines.append(f"{sha256(raw)}  {p.name}\n")
    (OUT / "SHA256SUMS.txt").write_text("".join(lines), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
